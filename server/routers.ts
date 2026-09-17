import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { checkPasswordStrength, PASSWORD_MIN_LENGTH, PASSWORD_REQUIREMENTS_MESSAGE } from "@shared/passwordStrength";
import { invokeLLM } from "./_core/llm";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import { assertRecordsScopedToCountry } from "./countryScope";
import { analyzePosmItems } from "./posmAnalysis";
import type { Country, User } from "../drizzle/schema";

/**
 * Bridges an AppUser (username/password login) into a server session that
 * `protectedProcedure` recognizes. Without this, the auth lockdown
 * (Tasks #5/#6/#9/#10 — protectedProcedure on every mutation, ctx.user-derived
 * audit identity) would 401 every call from app-user logins, because
 * `appUsers.verifyLogin` historically only returned the user payload to the
 * client and never established a server-side session cookie.
 *
 * Implementation notes:
 * - We reuse the existing OAuth session infrastructure (signed JWT in
 *   `COOKIE_NAME`, verified by `sdk.authenticateRequest` and looked up via
 *   `db.getUserByOpenId`) by upserting a `users` row, then issuing a session
 *   token with that openId.
 * - `users.openId` is namespaced with the `APP_USER_OPEN_ID_PREFIX` to avoid
 *   colliding with real OAuth `openId` values; the bare lowercase username is
 *   stored in `users.name`, which is what `getAuditActor(ctx)` returns and
 *   what `requireAppOwner(ctx)` uses to re-validate against the `appUsers`
 *   table. Helpers should always read identity from `ctx.user.name`, not
 *   `ctx.user.openId`.
 * - `users.role` is set to `'admin'` for AppUser admins/owners so that
 *   `adminProcedure` (which checks `ctx.user.role === 'admin'`) accepts them.
 *   For non-admin AppUser viewers we leave the default `'user'` role.
 */
const APP_USER_OPEN_ID_PREFIX = "appuser:";

async function establishAppUserSession(
  ctx: { req: import("express").Request; res: import("express").Response },
  appUser: { username: string; role: "admin" | "viewer"; isOwner: boolean; isPlatformAdmin?: boolean },
): Promise<void> {
  const trustedName = appUser.username.toLowerCase();
  const namespacedOpenId = `${APP_USER_OPEN_ID_PREFIX}${trustedName}`;
  // A user must hit `adminProcedure` if they are admin in *any* country, even
  // when their global `role` is "viewer" (per-country override admins).
  // The per-country admin enforcement still happens inside each handler via
  // `requireCountryAdmin`, so this gate only filters out users who have no
  // admin rights anywhere.
  const isPlatformAdmin = appUser.isPlatformAdmin ?? (appUser.isOwner || appUser.role === "admin");
  await db.upsertUser({
    openId: namespacedOpenId,
    name: trustedName,
    loginMethod: "app-user",
    role: isPlatformAdmin ? "admin" : "user",
    lastSignedIn: new Date(),
  });
  // Sign the session manually so we control every field. `createSessionToken`
  // would default `appId` to `ENV.appId` (VITE_APP_ID), which is unset in this
  // deployment — and `verifySession` rejects payloads with any empty required
  // field, causing every subsequent request to come back as 401. Using a
  // stable literal keeps the session valid regardless of OAuth env config.
  const sessionToken = await sdk.signSession(
    { openId: namespacedOpenId, appId: "ssof-app-user", name: trustedName },
    { expiresInMs: ONE_YEAR_MS },
  );
  const cookieOptions = getSessionCookieOptions(ctx.req);
  ctx.res.cookie(COOKIE_NAME, sessionToken, {
    ...cookieOptions,
    maxAge: ONE_YEAR_MS,
  });
}

/**
 * Returns the trusted username for audit-log attribution, derived from the
 * authenticated session (`ctx.user`). Never trust client-supplied usernames
 * for audit identity — always use this helper instead.
 */
const PERFORMANCE_COUNTRIES = ["Lebanon", "Syria", "Libya", "KSA"] as const;

const countrySchema = z.enum(PERFORMANCE_COUNTRIES);

const performanceRequestSchema = z.object({
  country: z.enum(PERFORMANCE_COUNTRIES),
  preset: z.enum(["month", "qtd", "ytd", "l12m", "custom"]).default("ytd"),
  anchor: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  compare: z.enum(["plan", "ly", "prev"]).default("plan"),
  filters: z.object({
    weights: z.array(z.string()).optional(),
    categories: z.array(z.string()).optional(),
    packaging: z.array(z.string()).optional(),
    flavours: z.array(z.string()).optional(),
  }).optional(),
  refresh: z.boolean().optional(),
});

/** Countries the caller may read (owners: all four). */
async function accessibleCountries(ctx: { user: User }): Promise<Array<(typeof PERFORMANCE_COUNTRIES)[number]>> {
  const username = ctx.user.name;
  if (!username) return [];
  const requester = await db.getAppUserByUsername(username);
  if (!requester) return [];
  if (requester.isOwner) return [...PERFORMANCE_COUNTRIES];
  let allowed: string[] = [];
  try {
    const parsed: unknown = JSON.parse(requester.countries);
    if (Array.isArray(parsed)) allowed = parsed.filter((c): c is string => typeof c === "string");
  } catch {
    allowed = [];
  }
  return PERFORMANCE_COUNTRIES.filter(c => allowed.some(a => a.toLowerCase() === c.toLowerCase()));
}

function getAuditActor(ctx: { user: User | null }): string {
  return ctx.user?.name?.trim() || "System";
}

async function requireAppOwner(ctx: { user: User }) {
  const username = ctx.user.name;
  if (!username) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No username on session" });
  }
  const requester = await db.getAppUserByUsername(username);
  if (!requester?.isOwner) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Owner privileges required" });
  }
  return requester;
}

/**
 * Enforces per-user country access on a country-scoped endpoint (Task #20).
 *
 * Every signed-in caller is expected to have a matching `appUsers` row whose
 * `countries` JSON list constrains which country datasets they may read or
 * mutate. The owner flag short-circuits the check (owners see every country).
 *
 * Throws TRPCError(FORBIDDEN) when:
 *   - the session has no username (defensive, should never happen on a
 *     `protectedProcedure`),
 *   - no `appUsers` row exists for that username (e.g. an OAuth-only session
 *     that bypassed `appUsers.verifyLogin`), or
 *   - the requested country is not in the caller's assigned-country list.
 *
 * Compares country names case-insensitively to match how
 * `verifyAppUserLogin` already compares them.
 */
async function requireCountryAccess(
  ctx: { user: User },
  country: string,
): Promise<void> {
  const username = ctx.user.name;
  if (!username) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No username on session" });
  }
  const requester = await db.getAppUserByUsername(username);
  if (!requester) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No country access configured for this account",
    });
  }
  if (requester.isOwner) return;
  let allowed: string[] = [];
  try {
    const parsed: unknown = JSON.parse(requester.countries);
    if (Array.isArray(parsed)) {
      allowed = parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    allowed = [];
  }
  const target = country.toLowerCase();
  if (!allowed.some(c => c.toLowerCase() === target)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You do not have access to ${country}`,
    });
  }
}

/**
 * Per-country admin gate. Use inside any mutation that the legacy global
 * `adminProcedure` used to gate, where the action is scoped to a specific
 * country. Equivalent to `requireCountryAccess` *plus* a check that the
 * caller's effective role for that country is "admin" (per-country override
 * if present, otherwise the user's global `role`). Owners always pass.
 *
 * `adminProcedure` only verifies that the caller is admin in *some* country
 * (so platform-wide endpoints still work), so country-scoped admin handlers
 * MUST also call this helper to keep e.g. a "Lebanon-admin / KSA-viewer"
 * user from mutating KSA data.
 */
async function requireCountryAdmin(
  ctx: { user: User },
  country: string,
): Promise<void> {
  const username = ctx.user.name;
  if (!username) {
    throw new TRPCError({ code: "FORBIDDEN", message: "No username on session" });
  }
  const requester = await db.getAppUserByUsername(username);
  if (!requester) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No country access configured for this account",
    });
  }
  if (requester.isOwner) return;
  let allowed: string[] = [];
  try {
    const parsed: unknown = JSON.parse(requester.countries);
    if (Array.isArray(parsed)) {
      allowed = parsed.filter((c): c is string => typeof c === "string");
    }
  } catch {
    allowed = [];
  }
  const target = country.toLowerCase();
  if (!allowed.some(c => c.toLowerCase() === target)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `You do not have access to ${country}`,
    });
  }
  const effective = db.getEffectiveAppRole(requester, country);
  if (effective !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Admin role required for ${country}`,
    });
  }
}

/**
 * Resolve the country a SKU belongs to and enforce per-country access.
 *
 * Several `country.*` mutations only take a `skuId` and historically treated
 * `input.country` as optional audit-log metadata, which meant a non-owner
 * with access to (say) Lebanon could call them with the field omitted and
 * mutate a SKU in another country. This helper looks up the SKU's actual
 * country and enforces `requireCountryAccess` against it. If the caller
 * supplied an `input.country` that disagrees with the SKU's true country, we
 * reject — otherwise an attacker could pass a country they have access to
 * while editing a SKU they do not.
 *
 * Returns the SKU's resolved country so callers can use it for audit logging.
 */
async function requireSkuCountryAccess(
  ctx: { user: User },
  skuId: number,
  providedCountry?: string,
): Promise<Country> {
  const country = await db.getSkuCountry(skuId);
  if (!country) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `SKU ${skuId} not found`,
    });
  }
  await requireCountryAccess(ctx, country);
  if (
    providedCountry &&
    providedCountry.toLowerCase() !== country.toLowerCase()
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `SKU ${skuId} does not belong to ${providedCountry}`,
    });
  }
  return country;
}

/**
 * Same as `requireSkuCountryAccess` but additionally enforces admin role for
 * the resolved country. Used by SKU-by-id mutations that previously sat on
 * `adminProcedure` — those handlers now need to verify the caller is admin
 * for the SKU's specific country, not just admin somewhere.
 */
async function requireSkuCountryAdmin(
  ctx: { user: User },
  skuId: number,
  providedCountry?: string,
): Promise<Country> {
  const country = await requireSkuCountryAccess(ctx, skuId, providedCountry);
  await requireCountryAdmin(ctx, country);
  return country;
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ==================== PERIODS ====================
  periods: router({
    list: protectedProcedure
      .input(z.object({ country: z.string().optional() }).optional())
      .query(async ({ input }) => {
        await db.ensurePeriods();
        if (input?.country) {
          return db.getPeriodsForCountry(input.country as import('../drizzle/schema').Country);
        }
        return db.getAllPeriods();
      }),
    init: adminProcedure.mutation(async ({ ctx }) => {
      // Lebanon-implicit endpoint — gate on Lebanon admin specifically so a
      // Syria-only admin can't initialise the global Lebanon period table.
      await requireCountryAdmin(ctx, "Lebanon");
      return db.ensurePeriods();
    }),
    existingYears: protectedProcedure
      .input(z.object({ country: z.string().optional() }).optional())
      .query(async ({ input }) => {
        return db.getExistingYearsForFilter(input?.country as import('../drizzle/schema').Country | undefined);
      }),
    addYear: adminProcedure
      .input(z.object({ year: z.number().min(2024).max(2040) }))
      .mutation(async ({ ctx, input }) => {
        const result = await db.addYear(input.year);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "add_year",
          sheet: "Periods",
          details: `Added year ${input.year} with 12 monthly periods`,
        });
        return result;
      }),
  }),

  // ==================== SKUs ====================
  skus: router({
    list: protectedProcedure.query(async () => {
      return db.getAllSkus();
    }),
    create: adminProcedure
      .input(z.object({
        name: z.string().min(1),
        weight: z.string(),
        category: z.enum(["Core", "NPI"]).optional(),
        isExcludedFromTotal: z.boolean().optional(),
              }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, "Lebanon");
        const result = await db.createSku(input);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "add_sku",
          sheet: "SKU",
          skuName: input.name,
          details: `Created SKU: ${input.name} (${input.weight}, ${input.category || "Core"})`,
        });
        return result;
      }),
    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, "Lebanon");
        const allSkus = await db.getAllSkus();
        const sku = allSkus.find(s => s.id === input.id);
        await db.deleteSku(input.id);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "delete_sku",
          sheet: "SKU",
          skuName: sku?.name || `ID:${input.id}`,
          details: `Deleted SKU and all associated data`,
        });
        return { success: true };
      }),
    updateCategory: adminProcedure
      .input(z.object({ id: z.number(), category: z.enum(["Core", "NPI"]) }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, "Lebanon");
        const allSkus = await db.getAllSkus();
        const sku = allSkus.find(s => s.id === input.id);
        const oldCategory = sku?.category || "unknown";
        await db.updateSkuCategory(input.id, input.category);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "change_category",
          sheet: "SKU",
          skuName: sku?.name || `ID:${input.id}`,
          field: "category",
          oldValue: oldCategory,
          newValue: input.category,
        });
        return { success: true };
      }),
    reorder: adminProcedure
      .input(z.object({ orderedIds: z.array(z.number()) }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, "Lebanon");
        await db.reorderLebanonSkus(input.orderedIds);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "reorder_sku",
          sheet: "SKU",
          details: `Reordered ${input.orderedIds.length} Lebanon SKUs`,
        });
        return { success: true };
      }),
  }),

  // ==================== DATA RETRIEVAL ====================
  // The `data.*` queries below all return Lebanon-scoped data (SKUs, periods,
  // forecast/ims/shipment/arrival/planning rows are pulled from the Lebanon
  // tables). Per Task #20, gate them behind `requireCountryAccess(_, "Lebanon")`
  // so a Syria-only or Libya-only viewer cannot pull Lebanon data via these
  // legacy endpoints.
  data: router({
    forecast: protectedProcedure.query(async ({ ctx }) => {
      await requireCountryAccess(ctx, "Lebanon");
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getForecastData();
      return { skus: allSkus, periods: allPeriods, data };
    }),
    ims: protectedProcedure.query(async ({ ctx }) => {
      await requireCountryAccess(ctx, "Lebanon");
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getImsData();
      return { skus: allSkus, periods: allPeriods, data };
    }),
    shipment: protectedProcedure.query(async ({ ctx }) => {
      await requireCountryAccess(ctx, "Lebanon");
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getShipmentData();
      return { skus: allSkus, periods: allPeriods, data };
    }),
    arrival: protectedProcedure.query(async ({ ctx }) => {
      await requireCountryAccess(ctx, "Lebanon");
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const data = await db.getArrivalData();
      const shipmentDataAll = await db.getShipmentData();
      return { skus: allSkus, periods: allPeriods, data, shipment: shipmentDataAll };
    }),
    planningFg: protectedProcedure
      .input(z.object({ weight: z.string().optional() }).optional())
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, "Lebanon");
        return db.getFullPlanningData(input?.weight);
      }),
    imsVsForecast: protectedProcedure.query(async ({ ctx }) => {
      await requireCountryAccess(ctx, "Lebanon");
      const allSkus = await db.getSkusForCountry('Lebanon');
      const allPeriods = await db.getPeriodsForCountry('Lebanon');
      const forecast = await db.getForecastData();
      const ims = await db.getImsData();
      return { skus: allSkus, periods: allPeriods, forecast, ims };
    }),
    uploadHistory: protectedProcedure.query(async () => {
      return db.getUploadHistory();
    }),
    exportAll: protectedProcedure.query(async ({ ctx }) => {
      await requireCountryAccess(ctx, "Lebanon");
      return db.getFullPlanningData();
    }),
  }),

  // ==================== DATA UPDATE ====================
  update: router({
    forecastCell: protectedProcedure
      .input(z.object({ skuId: z.number(), periodId: z.number(), value: z.string(), skuName: z.string().optional(), periodLabel: z.string().optional(), oldValue: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        // Clamp to non-negative
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertForecastData(input.skuId, input.periodId, clampedValue);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "Forecast",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "value",
          oldValue: input.oldValue || "",
          newValue: input.value,
          details: `Changed from ${input.oldValue || "(empty)"} to ${input.value}`,
        });
        return { success: true };
      }),
    imsCell: protectedProcedure
      .input(z.object({ skuId: z.number(), periodId: z.number(), value: z.string(), isActual: z.boolean(), country: z.string().default("Lebanon"), skuName: z.string().optional(), periodLabel: z.string().optional(), oldValue: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "IMS", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.upsertImsData(input.skuId, input.periodId, input.value, input.isActual);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "IMS",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "value",
          oldValue: input.oldValue || "",
          newValue: input.value,
          details: `Changed from ${input.oldValue || "(empty)"} to ${input.value}`,
        });
        return { success: true };
      }),
    shipmentCell: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string().optional(), week2: z.string().optional(),
        week3: z.string().optional(), week4: z.string().optional(),
        skuName: z.string().optional(), periodLabel: z.string().optional(),
        oldWeek1: z.string().optional(), oldWeek2: z.string().optional(),
        oldWeek3: z.string().optional(), oldWeek4: z.string().optional(),
        country: z.string().default("Lebanon"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { skuId, periodId, skuName, periodLabel, oldWeek1, oldWeek2, oldWeek3, oldWeek4, country, ...weeks } = input;
        await requireCountryAccess(ctx, country);
        await assertRecordsScopedToCountry(country, "Shipment", [{ skuId, periodId }], "Save");
        await db.upsertShipmentData(skuId, periodId, weeks);
        const changes: string[] = [];
        if (weeks.week1 !== undefined) changes.push(`W1: ${oldWeek1 || "0"} → ${weeks.week1}`);
        if (weeks.week2 !== undefined) changes.push(`W2: ${oldWeek2 || "0"} → ${weeks.week2}`);
        if (weeks.week3 !== undefined) changes.push(`W3: ${oldWeek3 || "0"} → ${weeks.week3}`);
        if (weeks.week4 !== undefined) changes.push(`W4: ${oldWeek4 || "0"} → ${weeks.week4}`);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "Shipment",
          skuName,
          periodLabel,
          field: changes.map(c => c.split(":")[0]).join(", "),
          oldValue: changes.map(c => c.split(" → ")[0]).join(", "),
          newValue: changes.map(c => c.split(" → ")[1]).join(", "),
          details: changes.join("; "),
        });
        return { success: true };
      }),
    arrivalCell: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string().optional(), week2: z.string().optional(),
        week3: z.string().optional(), week4: z.string().optional(),
        skuName: z.string().optional(), periodLabel: z.string().optional(),
        oldWeek1: z.string().optional(), oldWeek2: z.string().optional(),
        oldWeek3: z.string().optional(), oldWeek4: z.string().optional(),
        country: z.string().default("Lebanon"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { skuId, periodId, skuName, periodLabel, oldWeek1, oldWeek2, oldWeek3, oldWeek4, country, ...weeks } = input;
        await requireCountryAccess(ctx, country);
        await assertRecordsScopedToCountry(country, "Arrival", [{ skuId, periodId }], "Save");
        await db.upsertArrivalData(skuId, periodId, weeks);
        const changes: string[] = [];
        if (weeks.week1 !== undefined) changes.push(`W1: ${oldWeek1 || "0"} → ${weeks.week1}`);
        if (weeks.week2 !== undefined) changes.push(`W2: ${oldWeek2 || "0"} → ${weeks.week2}`);
        if (weeks.week3 !== undefined) changes.push(`W3: ${oldWeek3 || "0"} → ${weeks.week3}`);
        if (weeks.week4 !== undefined) changes.push(`W4: ${oldWeek4 || "0"} → ${weeks.week4}`);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "Arrival",
          skuName,
          periodLabel,
          field: changes.map(c => c.split(":")[0]).join(", "),
          oldValue: changes.map(c => c.split(" → ")[0]).join(", "),
          newValue: changes.map(c => c.split(" → ")[1]).join(", "),
          details: changes.join("; "),
        });
        return { success: true };
      }),
    syncImsAndForecast: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
        source: z.string().optional(),
        country: z.string().default("Lebanon"),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Planning FG (IMS sync)", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        // Clamp to non-negative
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        // Update both IMS and Forecast tables to keep them in sync (two-way)
        await db.upsertImsData(input.skuId, input.periodId, clampedValue, false);
        await db.upsertForecastData(input.skuId, input.periodId, clampedValue);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: input.source || "Planning FG (IMS sync)",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "IMS + Forecast",
          oldValue: input.oldValue || "",
          newValue: input.value,
          details: `Synced IMS and Forecast: ${input.oldValue || "(empty)"} → ${input.value}`,
        });
        return { success: true };
      }),
    applyRecommendation: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), newForecast: z.string(), oldForecast: z.string(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(), source: z.string().optional(),
        title: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Only update the Forecast table — do NOT touch IMS (actual sales)
        await db.upsertForecastData(input.skuId, input.periodId, input.newForecast);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "apply_recommendation",
          sheet: input.source || "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "Forecast",
          oldValue: input.oldForecast,
          newValue: input.newForecast,
          details: `Applied recommendation: ${input.title || ""} | Forecast: ${input.oldForecast} → ${input.newForecast}`,
        });
        return { success: true };
      }),
    rollbackRecommendation: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), oldForecast: z.string(), appliedForecast: z.string(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(), source: z.string().optional(),
        title: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Rollback: restore the original Forecast value
        await db.upsertForecastData(input.skuId, input.periodId, input.oldForecast);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "rollback_recommendation",
          sheet: input.source || "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "Forecast",
          oldValue: input.appliedForecast,
          newValue: input.oldForecast,
          details: `Rolled back recommendation: ${input.title || ""} | Forecast restored: ${input.appliedForecast} → ${input.oldForecast}`,
        });
        return { success: true };
      }),
    invoicedSHP: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.number().default(0), week2: z.number().default(0),
        week3: z.number().default(0), week4: z.number().default(0),
        skuName: z.string().optional(), periodLabel: z.string().optional(),
        country: z.string().default("Lebanon"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { skuId, periodId, skuName, periodLabel, week1, week2, week3, week4, country } = input;
        await requireCountryAccess(ctx, country);
        await assertRecordsScopedToCountry(country, "Planning FG (Invoiced SHP)", [{ skuId, periodId }], "Save");
        // 1. Save shipment weekly data
        await db.upsertShipmentData(skuId, periodId, {
          week1: String(week1), week2: String(week2), week3: String(week3), week4: String(week4),
        });
        // 2. Update planningFgData.invoiced with the monthly total
        const invoicedTotal = week1 + week2 + week3 + week4;
        await db.upsertPlanningFgData(skuId, periodId, { invoiced: String(invoicedTotal) });
        // 3. Compute arrivals +2 weeks: W1→W3(same), W2→W4(same), W3→W1(next), W4→W2(next)
        // Get the country's periods sorted by sortOrder to find next period
        const allPeriods = await db.getPeriodsForCountry(country as import('../drizzle/schema').Country);
        const currentPeriodIdx = allPeriods.findIndex(p => p.id === periodId);
        const nextPeriod = currentPeriodIdx >= 0 && currentPeriodIdx < allPeriods.length - 1
          ? allPeriods[currentPeriodIdx + 1] : null;
        // Same-period arrivals: W1 ships → W3 arrives, W2 ships → W4 arrives
        const sameMonthArrival = { week3: String(week1), week4: String(week2) };
        // Next-period arrivals: W3 ships → W1 arrives, W4 ships → W2 arrives
        const nextMonthArrival = nextPeriod
          ? { week1: String(week3), week2: String(week4) } : null;
        // Fetch existing arrival data for same period to preserve W1/W2
        await db.upsertArrivalData(skuId, periodId, sameMonthArrival);
        if (nextPeriod && nextMonthArrival) {
          await db.upsertArrivalData(skuId, nextPeriod.id, nextMonthArrival);
        }
        // 4. Recompute planningFgData.arrivals monthly totals from arrivalData
        const arrivalRows = await db.getArrivalData();
        const sameArrRow = arrivalRows.find(r => r.skuId === skuId && r.periodId === periodId);
        if (sameArrRow) {
          const sameTotal = (parseFloat(sameArrRow.week1 || '0') + parseFloat(sameArrRow.week2 || '0') +
            parseFloat(sameArrRow.week3 || '0') + parseFloat(sameArrRow.week4 || '0'));
          await db.upsertPlanningFgData(skuId, periodId, { arrivals: String(sameTotal) });
        }
        if (nextPeriod) {
          const nextArrRow = arrivalRows.find(r => r.skuId === skuId && r.periodId === nextPeriod.id);
          if (nextArrRow) {
            const nextTotal = (parseFloat(nextArrRow.week1 || '0') + parseFloat(nextArrRow.week2 || '0') +
              parseFloat(nextArrRow.week3 || '0') + parseFloat(nextArrRow.week4 || '0'));
            await db.upsertPlanningFgData(skuId, nextPeriod.id, { arrivals: String(nextTotal) });
          }
        }
        await db.logAudit({
          username: getAuditActor(ctx),
          action: 'edit_cell',
          sheet: 'Planning FG (Invoiced SHP)',
          skuName,
          periodLabel,
          field: 'Invoiced (SHP) W1-W4',
          oldValue: '',
          newValue: `W1=${week1}, W2=${week2}, W3=${week3}, W4=${week4} (Total=${invoicedTotal})`,
          details: `Shipment entered: W1=${week1}→arrives W3 same month, W2=${week2}→arrives W4 same month, W3=${week3}→arrives W1 next month, W4=${week4}→arrives W2 next month`,
        });
        return { success: true, invoicedTotal, nextPeriodId: nextPeriod?.id };
      }),
    planningFgCell: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        openingStock: z.string().optional(), adjustments: z.string().optional(),
        invoiced: z.string().optional(), arrivals: z.string().optional(),
        skuName: z.string().optional(), periodLabel: z.string().optional(),
        oldOpeningStock: z.string().optional(), oldAdjustments: z.string().optional(),
        oldInvoiced: z.string().optional(), oldArrivals: z.string().optional(),
        country: z.string().default("Lebanon"),
      }))
      .mutation(async ({ ctx, input }) => {
        const { skuId, periodId, skuName, periodLabel, oldOpeningStock, oldAdjustments, oldInvoiced, oldArrivals, country, ...data } = input;
        await requireCountryAccess(ctx, country);
        await assertRecordsScopedToCountry(country, "Planning FG", [{ skuId, periodId }], "Save");
        await db.upsertPlanningFgData(skuId, periodId, data);
        const changes: string[] = [];
        if (data.openingStock !== undefined) changes.push(`Opening Stock: ${oldOpeningStock || "0"} → ${data.openingStock}`);
        if (data.adjustments !== undefined) changes.push(`Adjustments: ${oldAdjustments || "0"} → ${data.adjustments}`);
        if (data.invoiced !== undefined) changes.push(`Invoiced: ${oldInvoiced || "0"} → ${data.invoiced}`);
        if (data.arrivals !== undefined) changes.push(`Arrivals: ${oldArrivals || "0"} → ${data.arrivals}`);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "Planning FG",
          skuName,
          periodLabel,
          field: changes.map(c => c.split(":")[0]).join(", "),
          oldValue: changes.map(c => c.split(" → ")[0]).join(", "),
          newValue: changes.map(c => c.split(" → ")[1]).join(", "),
          details: changes.join("; "),
        });
        return { success: true };
      }),
    // Sync Planning FG arrival to arrivalData source table
    syncPlanningFgArrival: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
        country: z.string().default("Lebanon"),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Planning FG (Arrival sync)", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertPlanningFgData(input.skuId, input.periodId, { arrivals: clampedValue });
        await db.upsertArrivalData(input.skuId, input.periodId, { week1: clampedValue, week2: "0", week3: "0", week4: "0" });
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "Actual arrivals / Planned Orders",
          oldValue: input.oldValue || "0",
          newValue: clampedValue,
          details: `Planning FG arrival synced to source: ${input.oldValue || "0"} → ${clampedValue}`,
        });
        return { success: true };
      }),
    // Auto-fill IMS from Forecast for a given period
    autoFillImsFromForecast: protectedProcedure
      .input(z.object({
        periodId: z.number(),
                country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        const skus = await db.getSkusForCountry(country);
        const forecastData = await db.getForecastDataForCountry(country);
        const imsDataArr = await db.getImsDataForCountry(country);

        // Build maps
        const forecastMap = new Map<string, string>();
        for (const f of forecastData) forecastMap.set(`${f.skuId}-${f.periodId}`, f.value ?? "0");
        const imsMapExisting = new Map<string, { value: string; isActual: boolean }>();
        for (const i of imsDataArr) imsMapExisting.set(`${i.skuId}-${i.periodId}`, { value: i.value ?? "0", isActual: i.isActual ?? false });

        let filled = 0;
        for (const sku of skus) {
          const key = `${sku.id}-${input.periodId}`;
          const forecastVal = forecastMap.get(key) ?? "0";
          const fNum = parseFloat(forecastVal) || 0;
          if (fNum === 0) continue; // skip if no forecast

          // Overwrite IMS with forecast value, marking source so the UI can
          // color these "system-pushed" cells differently from manually
          // entered IMS.
          await db.upsertImsData(sku.id, input.periodId, forecastVal, false, "auto_forecast");
          filled++;
        }

        await db.logAudit({
          country, username: getAuditActor(ctx),
          action: "auto_fill", sheet: "IMS",
          details: `Auto-filled ${filled} IMS cells from Forecast for period ${input.periodId}`,
        });

        return { success: true, filled };
      }),
  }),

  // ==================== BULK UPLOAD ====================
  upload: router({
    forecast: adminProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            value: z.string(),
          })),
        })),
                country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        await requireCountryAdmin(ctx, country);
        let periodsRefreshed = await db.getPeriodsForCountry(country);
        if (periodsRefreshed.length === 0) { await db.ensurePeriods(); periodsRefreshed = await db.getPeriodsForCountry(country); }
        let allSkus = await db.getSkusForCountry(country, true);
        
        const bulkRecords: { skuId: number; periodId: number; value: string }[] = [];
        for (const rec of input.records) {
          let sku = allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight);
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) {
            const result = await db.createSkuForCountry(country, { name: rec.skuName, weight: rec.weight });
            allSkus = await db.getSkusForCountry(country, true);
            sku = allSkus.find(s => s.id === result.id);
          }
          if (!sku) continue;
          
          for (const val of rec.values) {
            const period = periodsRefreshed.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              bulkRecords.push({ skuId: sku.id, periodId: period.id, value: val.value });
            }
          }
        }
        await assertRecordsScopedToCountry(country, "Forecast", bulkRecords, "Save");
        await db.bulkUpsertForecast(bulkRecords);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "upload",
          sheet: "Forecast",
          details: `Uploaded ${bulkRecords.length} forecast records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    imsActuals: adminProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            value: z.string(),
            isActual: z.boolean(),
          })),
        })),
                country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        await requireCountryAdmin(ctx, country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        const bulkRecords: { skuId: number; periodId: number; value: string; isActual: boolean }[] = [];
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = allPeriods.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              bulkRecords.push({ skuId: sku.id, periodId: period.id, value: val.value, isActual: val.isActual });
            }
          }
        }
        await assertRecordsScopedToCountry(country, "IMS", bulkRecords, "Save");
        await db.bulkUpsertIms(bulkRecords);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "upload",
          sheet: "IMS Actuals",
          details: `Uploaded ${bulkRecords.length} IMS records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    openingStock: adminProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          value: z.string(),
          periodYear: z.number(),
          periodMonth: z.number(),
        })),
                country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        await requireCountryAdmin(ctx, country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        const resolved: { skuId: number; periodId: number; value: string }[] = [];
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          const period = allPeriods.find(p => p.year === rec.periodYear && p.month === rec.periodMonth);
          if (sku && period) {
            resolved.push({ skuId: sku.id, periodId: period.id, value: rec.value });
          }
        }
        await assertRecordsScopedToCountry(country, "Opening Stock", resolved, "Save");
        let processed = 0;
        for (const rec of resolved) {
          await db.upsertPlanningFgData(rec.skuId, rec.periodId, { openingStock: rec.value });
          processed++;
        }
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "upload",
          sheet: "Opening Stock",
          details: `Uploaded ${processed} opening stock records`,
        });
        return { success: true, processed };
      }),

    shipment: adminProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            week1: z.string().optional().default("0"),
            week2: z.string().optional().default("0"),
            week3: z.string().optional().default("0"),
            week4: z.string().optional().default("0"),
            value: z.string().optional(), // Lebanon monthly total
          })),
        })),
                country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        await requireCountryAdmin(ctx, country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        const bulkRecords: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = allPeriods.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              const week1 = val.value !== undefined ? val.value : (val.week1 ?? "0");
              const week2 = val.value !== undefined ? "0" : (val.week2 ?? "0");
              const week3 = val.value !== undefined ? "0" : (val.week3 ?? "0");
              const week4 = val.value !== undefined ? "0" : (val.week4 ?? "0");
              bulkRecords.push({ skuId: sku.id, periodId: period.id, week1, week2, week3, week4 });
            }
          }
        }
        await assertRecordsScopedToCountry(country, "Shipment", bulkRecords, "Save");
        await db.bulkUpsertShipment(bulkRecords);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "upload",
          sheet: "Shipment",
          details: `Uploaded ${bulkRecords.length} shipment records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    arrival: adminProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            week1: z.string().optional().default("0"),
            week2: z.string().optional().default("0"),
            week3: z.string().optional().default("0"),
            week4: z.string().optional().default("0"),
            value: z.string().optional(), // Lebanon monthly total
          })),
        })),
                country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        await requireCountryAdmin(ctx, country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const allSkus = await db.getSkusForCountry(country, true);
        const bulkRecords: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
        for (const rec of input.records) {
          const sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = allPeriods.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              const week1 = val.value !== undefined ? val.value : (val.week1 ?? "0");
              const week2 = val.value !== undefined ? "0" : (val.week2 ?? "0");
              const week3 = val.value !== undefined ? "0" : (val.week3 ?? "0");
              const week4 = val.value !== undefined ? "0" : (val.week4 ?? "0");
              bulkRecords.push({ skuId: sku.id, periodId: period.id, week1, week2, week3, week4 });
            }
          }
        }
        await assertRecordsScopedToCountry(country, "Arrival", bulkRecords, "Save");
        await db.bulkUpsertArrival(bulkRecords);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "upload",
          sheet: "Arrival",
          details: `Uploaded ${bulkRecords.length} arrival records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: bulkRecords.length };
      }),

    planningFgBulk: adminProcedure
      .input(z.object({
        records: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          values: z.array(z.object({
            year: z.number(),
            month: z.number(),
            openingStock: z.string(),
            adjustments: z.string(),
            invoiced: z.string().optional(),
            arrivals: z.string().optional(),
            ims: z.string().optional(), // IMS from Planning FG sheet
          })),
        })),
                country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        await requireCountryAdmin(ctx, country);
        let periodsRefreshed = await db.getPeriodsForCountry(country);
        if (periodsRefreshed.length === 0) { await db.ensurePeriods(); periodsRefreshed = await db.getPeriodsForCountry(country); }
        const allSkus = await db.getSkusForCountry(country, true);
        const pfgRecords: { skuId: number; periodId: number; openingStock?: string; adjustments?: string; invoiced?: string; arrivals?: string }[] = [];
        const imsRecords: { skuId: number; periodId: number; value: string; isActual: boolean }[] = [];
        const now = new Date();
        for (const rec of input.records) {
          let sku = allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight);
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          for (const val of rec.values) {
            const period = periodsRefreshed.find(p => p.year === val.year && p.month === val.month);
            if (period) {
              pfgRecords.push({
                skuId: sku.id, periodId: period.id,
                openingStock: val.openingStock, adjustments: val.adjustments,
                invoiced: val.invoiced || "0", arrivals: val.arrivals || "0",
              });
              if (val.ims !== undefined) {
                const imsNum = parseFloat(val.ims) || 0;
                const isActual = val.year < now.getFullYear() || (val.year === now.getFullYear() && val.month <= now.getMonth() + 1);
                imsRecords.push({ skuId: sku.id, periodId: period.id, value: imsNum.toString(), isActual });
              }
            }
          }
        }
        await assertRecordsScopedToCountry(country, "Planning FG", pfgRecords, "Save");
        await assertRecordsScopedToCountry(country, "Planning FG (IMS)", imsRecords, "Save");
        await db.bulkUpsertPlanningFg(pfgRecords);
        if (imsRecords.length > 0) await db.bulkUpsertIms(imsRecords);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: "upload",
          sheet: "Planning FG",
          details: `Uploaded ${pfgRecords.length} planning FG records for ${input.records.length} SKUs`,
        });
        return { success: true, processed: pfgRecords.length };
      }),
  }),

  // ==================== AUDIT TRAIL ====================
  audit: router({
    logs: protectedProcedure
      .input(z.object({
        limit: z.number().min(1).max(200).optional(),
        offset: z.number().min(0).optional(),
                action: z.string().optional(),
        sheet: z.string().optional(),
      }).optional())
      .query(async ({ input }) => {
        return db.getAuditLogs(input || {});
      }),
    logAction: protectedProcedure
      .input(z.object({
        action: z.string(),
        sheet: z.string().optional(),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
        field: z.string().optional(),
        oldValue: z.string().optional(),
        newValue: z.string().optional(),
        details: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.logAudit({ ...input, username: getAuditActor(ctx) });
        return { success: true };
      }),
  }),

  // ==================== SSOF VERSIONS ====================
  versions: router({
    list: protectedProcedure
      .input(z.object({ country: z.enum(['Lebanon', 'Syria', 'Libya', 'KSA']).optional() }).optional())
      .query(async ({ input }) => {
        return db.listVersions(input?.country as any);
      }),

    save: protectedProcedure
      .input(z.object({
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        country: z.enum(['Lebanon', 'Syria', 'Libya', 'KSA']).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const actor = getAuditActor(ctx);
        const country = (input.country || 'Lebanon') as import('../drizzle/schema').Country;
        // 1. Take country-scoped snapshot of current data
        const snapshot = await db.getFullSnapshot(country);

        // 2. Build changes summary from audit trail (since last version or all)
        const versions = await db.listVersions(country);
        const lastVersion = versions.length > 0 ? versions[0] : null;
        const auditResult = await db.getAuditLogs({ limit: 500 });
        const allLogs = auditResult.logs;
        const changesSince = lastVersion
          ? allLogs.filter(l => l.createdAt > lastVersion.createdAt)
          : allLogs;

        const changesSummary = {
          totalChanges: changesSince.length,
          bySheet: {} as Record<string, number>,
          byAction: {} as Record<string, number>,
          byUser: {} as Record<string, number>,
          recentChanges: changesSince.slice(0, 100).map(l => ({
            username: l.username,
            action: l.action,
            sheet: l.sheet,
            skuName: l.skuName,
            periodLabel: l.periodLabel,
            field: l.field,
            oldValue: l.oldValue,
            newValue: l.newValue,
            details: l.details,
            createdAt: l.createdAt,
          })),
          previousVersion: lastVersion ? lastVersion.name : null,
          skuCount: snapshot.skus.length,
          periodCount: snapshot.periods.length,
        };
        for (const log of changesSince) {
          if (log.sheet) changesSummary.bySheet[log.sheet] = (changesSummary.bySheet[log.sheet] || 0) + 1;
          changesSummary.byAction[log.action] = (changesSummary.byAction[log.action] || 0) + 1;
          changesSummary.byUser[log.username] = (changesSummary.byUser[log.username] || 0) + 1;
        }

        // 3. Generate Word document
        let docUrl: string | undefined;
        try {
          const { generateVersionDoc } = await import('./versionDoc');
          docUrl = await generateVersionDoc(input.name, input.description, changesSummary, snapshot);
        } catch (err) {
          console.error('[Version] Failed to generate Word doc:', err);
        }

        // 4. Save version
        const result = await db.saveVersion({
          name: input.name,
          description: input.description,
          savedBy: actor,
          snapshotData: snapshot,
          changesSummary,
          docUrl,
          country,
        });

        await db.logAudit({
          country,
          username: actor,
          action: 'save_version',
          sheet: 'SSOF Version',
          details: `Saved version "${input.name}" for ${country}${input.description ? ': ' + input.description : ''}`,
        });

        return { success: true, id: result.id, docUrl };
      }),

    load: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const version = await db.getVersionById(input.id);
        if (!version) throw new Error('Version not found');
        await requireCountryAdmin(ctx, version.country);
        await db.restoreSnapshot(version.snapshotData, version.country as any);
        await db.logAudit({
          country: version.country as any,
          username: getAuditActor(ctx),
          action: 'load_version',
          sheet: 'SSOF Version',
          details: `Loaded version "${version.name}" (ID: ${version.id}) for ${version.country}`,
        });
        return { success: true, name: version.name };
      }),

    delete: adminProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const version = await db.getVersionById(input.id);
        if (!version) throw new Error('Version not found');
        await requireCountryAdmin(ctx, version.country);
        await db.deleteVersion(input.id);
        await db.logAudit({
          username: getAuditActor(ctx),
          action: 'delete_version',
          sheet: 'SSOF Version',
          details: `Deleted version "${version.name}" (ID: ${version.id})`,
        });
        return { success: true };
      }),

    export: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const version = await db.getVersionById(input.id);
        if (!version) throw new Error('Version not found');
        return {
          name: version.name,
          description: version.description,
          savedBy: version.savedBy,
          createdAt: version.createdAt,
          snapshotData: version.snapshotData,
          changesSummary: version.changesSummary,
        };
      }),

    import: adminProcedure
      .input(z.object({
        versionData: z.any(), // The full version JSON from file
        country: z.enum(['Lebanon', 'Syria', 'Libya', 'KSA']).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const { versionData } = input;
        const country = (input.country || versionData.country || 'Lebanon') as import('../drizzle/schema').Country;
        await requireCountryAdmin(ctx, country);
        if (!versionData.snapshotData) throw new Error('Invalid version file: missing snapshot data');
        await db.restoreSnapshot(versionData.snapshotData, country);
        await db.logAudit({
          country,
          username: getAuditActor(ctx),
          action: 'import_version',
          sheet: 'SSOF Version',
          details: `Imported version "${versionData.name || 'Unknown'}" from local file for ${country}`,
        });
        return { success: true, name: versionData.name || 'Imported Version' };
      }),

    // ---- Version Comparison ----
    compare: protectedProcedure
      .input(z.object({ versionAId: z.number(), versionBId: z.number() }))
      .query(async ({ input }) => {
        const vA = await db.getVersionById(input.versionAId);
        const vB = await db.getVersionById(input.versionBId);
        if (!vA || !vB) throw new Error('One or both versions not found');
        return {
          versionA: { id: vA.id, name: vA.name, savedBy: vA.savedBy, createdAt: vA.createdAt, snapshot: vA.snapshotData },
          versionB: { id: vB.id, name: vB.name, savedBy: vB.savedBy, createdAt: vB.createdAt, snapshot: vB.snapshotData },
        };
      }),

    // ---- Version Comments ----
    comments: protectedProcedure
      .input(z.object({ versionId: z.number() }))
      .query(async ({ input }) => {
        return db.getVersionComments(input.versionId);
      }),

    addComment: protectedProcedure
      .input(z.object({ versionId: z.number(), comment: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const result = await db.addVersionComment({
          versionId: input.versionId,
          username: getAuditActor(ctx),
          comment: input.comment,
        });
        return { success: true, id: result.id };
      }),

    deleteComment: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await db.deleteVersionComment(input.id);
        return { success: true };
      }),

    // ---- Edit Count (for auto-save reminders) ----
    editCount: protectedProcedure
      .input(z.object({ country: z.string().optional() }))
      .query(async ({ input }) => {
        return { count: await db.getEditCountSinceVersion(input.country) };
      }),
  }),

  // ==================== ANALYSIS ====================
  analysis: router({
    overview: protectedProcedure.query(async () => {
      return db.getAnalysisOverview();
    }),
    bySku: protectedProcedure.query(async () => {
      return db.getAnalysisBySku();
    }),
    byWeight: protectedProcedure.query(async () => {
      return db.getAnalysisByWeight();
    }),
    byCategory: protectedProcedure.query(async () => {
      return db.getAnalysisByCategory();
    }),
    byFlavor: protectedProcedure.query(async () => {
      return db.getAnalysisByFlavor();
    }),
    production: protectedProcedure.query(async () => {
      return db.getAnalysisProduction();
    }),
    stockHealth: protectedProcedure.query(async () => {
      return db.getAnalysisStockHealth();
    }),
     stockSnapshot: protectedProcedure.query(async () => {
      return db.getStockSnapshot();
    }),
  }),
  // ==================== COUNTRY-SCOPED DATA ====================
  country: router({
    // Initialize a country's periods
    init: adminProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        await db.ensurePeriodsForCountry(input.country);
        return { success: true };
      }),
    // Fetch all data for a country
    data: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        const c = input.country;
        await db.ensurePeriodsForCountry(c);
        const [countrySkus, countryPeriods, forecast, actualProduction, ims, shipment, arrival] = await Promise.all([
          db.getSkusForCountry(c),
          db.getPeriodsForCountry(c),
          db.getForecastDataForCountry(c),
          db.getActualProductionDataForCountry(c),
          db.getImsDataForCountry(c),
          db.getShipmentDataForCountry(c),
          db.getArrivalDataForCountry(c),
        ]);
        return { skus: countrySkus, periods: countryPeriods, forecast, actualProduction, ims, shipment, arrival };
      }),
    // Get SKUs for a country
    skus: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]), includeInactive: z.boolean().optional() }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getSkusForCountry(input.country, input.includeInactive ?? false);
      }),
    // Unique active-SKU weights for the given country, ascending in grams.
    // Drives the dynamic Planning FG sidebar tabs (e.g. KSA → 250g, 500g
    // only if those weights actually exist in its SKUs).
    weights: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getActiveWeightsForCountry(input.country);
      }),
    // Create SKU for a country
    createSku: adminProcedure
      .input(z.object({
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        name: z.string().min(1),
        weight: z.string(),
        category: z.enum(["Core", "NPI"]).optional(),
        packagingType: z.enum(["Old", "New"]).optional(),
        isExcludedFromTotal: z.boolean().optional(),
              }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        const result = await db.createSkuForCountry(input.country, {
          name: input.name,
          weight: input.weight,
          category: input.category,
          packagingType: input.packagingType,
          isExcludedFromTotal: input.isExcludedFromTotal,
        });
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "create_sku",
          sheet: "SKU Management",
          skuName: input.name,
          details: `Created SKU: ${input.name} (${input.weight}) for ${input.country}`,
        });
        return result;
      }),
    // Update SKU packaging type
    updateSkuPackaging: adminProcedure
      .input(z.object({
        skuId: z.number(),
        packagingType: z.enum(["Old", "New"]),
                skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = await requireSkuCountryAdmin(ctx, input.skuId, input.country);
        await db.updateSkuPackagingType(input.skuId, input.packagingType);
        await db.logAudit({
          country,
          username: getAuditActor(ctx),
          action: "update_sku",
          sheet: "SKU Management",
          skuName: input.skuName,
          details: `Updated packaging type to ${input.packagingType}`,
          newValue: input.packagingType,
        });
        return { success: true };
      }),
    // Delete SKU
    deleteSku: adminProcedure
      .input(z.object({
        skuId: z.number(),
                skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = await requireSkuCountryAdmin(ctx, input.skuId, input.country);
        await db.deleteSku(input.skuId);
        await db.logAudit({
          country,
          username: getAuditActor(ctx),
          action: "delete_sku",
          sheet: "SKU Management",
          skuName: input.skuName,
          details: `Deleted SKU: ${input.skuName || input.skuId}`,
        });
        return { success: true };
      }),
    // Toggle SKU active/inactive
    toggleSkuActive: adminProcedure
      .input(z.object({
        skuId: z.number(),
        isActive: z.boolean(),
                skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = await requireSkuCountryAdmin(ctx, input.skuId, input.country);
        await db.toggleSkuActive(input.skuId, input.isActive);
        await db.logAudit({
          country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "SKU Management",
          skuName: input.skuName,
          details: `SKU ${input.isActive ? "enabled" : "disabled"}: ${input.skuName || input.skuId}`,
        });
        return { success: true };
      }),
    // Update forecast cell
    updateForecast: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        targetWeek: z.string().optional(), // "week1" | "week2" | "week3" | "week4"
        skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Forecast", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        const clamped = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertForecastData(input.skuId, input.periodId, clamped, input.targetWeek);
        await db.logAudit({
          country: input.country, username: getAuditActor(ctx),
          action: "edit", sheet: "Forecast Production",
          skuName: input.skuName, periodLabel: input.periodLabel,
          oldValue: input.oldValue || "", newValue: clamped,
          details: `Changed from ${input.oldValue || "(empty)"} to ${clamped}`,
        });
        return { success: true };
      }),
    // Update only the targetWeek for a forecast cell (without changing the value)
    updateForecastWeek: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        targetWeek: z.string(), // "week1" | "week2" | "week3" | "week4"
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Forecast", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.upsertForecastData(input.skuId, input.periodId, undefined as any, input.targetWeek);
        // Also update production to reflect the new week assignment
        const existing = await db.getForecastCellValue(input.skuId, input.periodId);
        if (existing && (input.country === "Syria" || input.country === "Libya")) {
          const val = existing.value ?? "0";
          const weeks = { week1: "0", week2: "0", week3: "0", week4: "0", [input.targetWeek]: val };
          await db.upsertShipmentData(input.skuId, input.periodId, { week1: weeks.week1, week2: weeks.week2, week3: weeks.week3, week4: weeks.week4 });
        }
        return { success: true };
      }),
    // Update actual production cell (Syria/Libya/KSA Forecast Production vs Actual)
    updateActualProduction: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(), value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        skuName: z.string().optional(),
        periodLabel: z.string().optional(), oldValue: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Actual Production", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        const clamped = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertActualProductionData(input.skuId, input.periodId, clamped);
        await db.logAudit({
          country: input.country, username: getAuditActor(ctx),
          action: "edit", sheet: "Actual Production",
          skuName: input.skuName, periodLabel: input.periodLabel,
          oldValue: input.oldValue || "", newValue: clamped,
          details: `Actual production changed from ${input.oldValue || "(empty)"} to ${clamped}`,
        });
        return { success: true };
      }),
    // Update production (shipment) cell
    updateProduction: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string(), week2: z.string(), week3: z.string(), week4: z.string(),
        arrivalOffsetValue: z.number().optional(),
        arrivalOffsetUnit: z.enum(["days", "weeks", "months"]).optional(),
        note: z.string().nullable().optional(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        skuName: z.string().optional(), periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Production", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.upsertShipmentData(input.skuId, input.periodId, {
          week1: input.week1, week2: input.week2, week3: input.week3, week4: input.week4,
          arrivalOffsetValue: input.arrivalOffsetValue,
          arrivalOffsetUnit: input.arrivalOffsetUnit,
          note: input.note,
          invoiceRef: input.invoiceRef,
          containerRef: input.containerRef,
        });
        await db.logAudit({
          country: input.country, username: getAuditActor(ctx),
          action: "edit", sheet: "Production",
          skuName: input.skuName, periodLabel: input.periodLabel,
          details: `Updated production weeks`,
        });
        return { success: true };
      }),
    updateProductionRefs: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        skuName: z.string().optional(), periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Production", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.upsertShipmentData(input.skuId, input.periodId, {
          invoiceRef: input.invoiceRef,
          containerRef: input.containerRef,
        });
        await db.logAudit({
          country: input.country, username: getAuditActor(ctx),
          action: "edit", sheet: "Production",
          skuName: input.skuName, periodLabel: input.periodLabel,
          details: `Updated refs — Invoice: ${input.invoiceRef ?? ""}, Container: ${input.containerRef ?? ""}`,
        });
        return { success: true };
      }),
    // Update arrival cell
    updateArrival: protectedProcedure
      .input(z.object({
        skuId: z.number(), periodId: z.number(),
        week1: z.string(), week2: z.string(), week3: z.string(), week4: z.string(),
        arrivalOffsetWeeks: z.number().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        skuName: z.string().optional(), periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.upsertArrivalData(input.skuId, input.periodId, {
          week1: input.week1, week2: input.week2, week3: input.week3, week4: input.week4,
        });
        await db.logAudit({
          country: input.country, username: getAuditActor(ctx),
          action: "edit", sheet: "Arrival",
          skuName: input.skuName, periodLabel: input.periodLabel,
          details: `Updated arrival data`,
        });
        return { success: true };
      }),
    // Add year for a country
    addYear: adminProcedure
      .input(z.object({
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        year: z.number().min(2024).max(2040),
              }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        const result = await db.addYearForCountry(input.country, input.year);
        await db.logAudit({
          country: input.country, username: getAuditActor(ctx),
          action: "add_year", sheet: "Periods",
          details: `Added year ${input.year} for ${input.country}`,
        });
        return result;
      }),
    // Get existing years for a country
    existingYears: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getExistingYearsForCountry(input.country);
      }),
    // Update SKU details (name, weight, category, packagingType)
    updateSku: adminProcedure
      .input(z.object({
        skuId: z.number(),
        name: z.string().min(1).optional(),
        weight: z.string().optional(),
        category: z.enum(["Core", "NPI"]).optional(),
        packagingType: z.enum(["Old", "New"]).optional(),
        priceToWs: z.number().nonnegative().nullable().optional(),
        priceWsToSemiWs: z.number().nonnegative().nullable().optional(),
        priceSemiWsToRetail: z.number().nonnegative().nullable().optional(),
        finalRspPerPack: z.number().nonnegative().nullable().optional(),
                skuName: z.string().optional(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const country = await requireSkuCountryAdmin(ctx, input.skuId, input.country);
        await db.updateSkuDetails(input.skuId, {
          name: input.name,
          weight: input.weight,
          category: input.category,
          packagingType: input.packagingType,
          priceToWs: input.priceToWs,
          priceWsToSemiWs: input.priceWsToSemiWs,
          priceSemiWsToRetail: input.priceSemiWsToRetail,
          finalRspPerPack: input.finalRspPerPack,
        });
        await db.logAudit({
          country,
          username: getAuditActor(ctx),
          action: "update_sku",
          sheet: "SKU Management",
          skuName: input.skuName || input.name,
          details: `Updated SKU details`,
        });
        return { success: true };
      }),
    // Update arrival status for a production batch (Syria/Libya)
    updateArrivalStatus: protectedProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        status: z.enum(["Pending", "In Transit", "Arrived", "Delayed", "Cleared", "Partially Cleared"]),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.updateShipmentArrivalStatus(input.skuId, input.periodId, input.status);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: `Arrival status changed to ${input.status}`,
        });
        return { success: true };
      }),

    // Update cleared qty for a production batch (Syria/Libya) - supports partial clearance
    updateClearedQty: protectedProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        clearedQty: z.number().nullable(),
        totalQty: z.number(), // full production qty to determine auto-status
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        const result = await db.updateShipmentClearedQty(
          input.skuId,
          input.periodId,
          input.clearedQty,
          input.totalQty
        );
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: input.clearedQty !== null
            ? `Cleared qty set to ${input.clearedQty} of ${input.totalQty} (${result?.autoStatus ?? "status unchanged"})`
            : `Cleared qty removed`,
        });
        return { success: true, autoStatus: result?.autoStatus };
      }),

    // Update cleared date for a production batch (Syria/Libya)
    updateClearedDate: protectedProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        clearedDate: z.string().nullable(), // ISO date string YYYY-MM-DD or null
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.updateShipmentClearedDate(input.skuId, input.periodId, input.clearedDate);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: input.clearedDate
            ? `Cleared date set to ${input.clearedDate}`
            : `Cleared date removed`,
        });
        return { success: true };
      }),

    // Update pending clear date for a production batch (Syria/Libya)
    updatePendingClearDate: protectedProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        pendingClearDate: z.string().nullable(), // ISO date string YYYY-MM-DD or null
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.updateShipmentPendingClearDate(input.skuId, input.periodId, input.pendingClearDate);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: input.pendingClearDate
            ? `Pending clear date set to ${input.pendingClearDate}`
            : `Pending clear date removed`,
        });
        return { success: true };
      }),

    // List all clearance events for a country
    clearanceEvents: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getClearanceEventsForCountry(input.country);
      }),

    // Add a new clearance event for a batch
    addClearanceEvent: protectedProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        clearedQty: z.string(),
        clearedDate: z.string(), // YYYY-MM-DD
        pendingClearDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival (Clearance)", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        const id = await db.addClearanceEvent(input);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: `Clearance event added: ${input.clearedQty} units on ${input.clearedDate}`,
        });
        return { id };
      }),

    // Update an existing clearance event
    updateClearanceEvent: protectedProcedure
      .input(z.object({
        eventId: z.number(),
        skuId: z.number(),
        periodId: z.number(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        clearedQty: z.string().optional(),
        clearedDate: z.string().optional(),
        pendingClearDate: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        invoiceRef: z.string().nullable().optional(),
        containerRef: z.string().nullable().optional(),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival (Clearance)", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        const { eventId, skuName, periodLabel, ...rest } = input;
        await db.updateClearanceEvent(eventId, rest);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Arrival",
          skuName,
          periodLabel,
          details: `Clearance event ${eventId} updated`,
        });
        return { success: true };
      }),

    // Delete a clearance event
    deleteClearanceEvent: protectedProcedure
      .input(z.object({
        eventId: z.number(),
        skuId: z.number(),
        periodId: z.number(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Arrival (Clearance)", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.deleteClearanceEvent(input.eventId, input.skuId, input.periodId, input.country);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Arrival",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          details: `Clearance event ${input.eventId} deleted`,
        });
        return { success: true };
      }),

    planningFg: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getFullPlanningDataForCountry(input.country as "Syria" | "Libya" | "KSA");
      }),

    // Update IMS cell for Syria/Libya
    updateIms: protectedProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "IMS", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        await db.upsertImsData(input.skuId, input.periodId, input.value, true);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "IMS",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: "IMS",
          newValue: input.value,
        });
        return { success: true };
      }),

    // Intl Analysis query for Syria/Libya
    intlAnalysis: protectedProcedure
      .input(z.object({ country: z.enum(["Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getIntlAnalysis(input.country);
      }),

    runningRate: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getRunningRateAnalysis(input.country);
      }),

    stockLevels: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getStockLevelAnalysis(input.country);
      }),

    forecastIntelligence: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getForecastIntelligence(input.country);
      }),

    currentMonthClosingStock: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getCurrentMonthClosingStock(input.country);
      }),

    // Country Performance pack — one cached aggregate per country + period.
    performance: protectedProcedure
      .input(performanceRequestSchema)
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        const { getCountryPerformance } = await import("./analysis/countryPerformance");
        return getCountryPerformance(input);
      }),

    // Side-by-side scorecard, limited to the countries the caller may see.
    performanceScorecard: protectedProcedure
      .input(z.object({
        preset: z.enum(["month", "qtd", "ytd", "l12m", "custom"]).default("ytd"),
        compare: z.enum(["plan", "ly", "prev"]).default("plan"),
      }))
      .query(async ({ ctx, input }) => {
        const countries = await accessibleCountries(ctx);
        const { getCountryScorecard } = await import("./analysis/countryPerformance");
        return getCountryScorecard(countries, input.preset, input.compare);
      }),

    // ── Board pack extras: frozen packs, presenter notes, slide layout, budget baseline ──
    boardSnapshots: protectedProcedure
      .input(z.object({ country: countrySchema }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        const rows = await db.listBoardPackSnapshots(input.country);
        return rows.map((r) => ({ id: r.id, name: r.name, windowLabel: r.windowLabel, frozenBy: r.frozenBy, createdAt: r.createdAt.toISOString() }));
      }),

    boardSnapshot: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const row = await db.getBoardPackSnapshot(input.id);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Board pack snapshot not found" });
        await requireCountryAccess(ctx, row.country);
        const { BoardHeadlineSchema } = await import("./analysis/countryPerformance.schemas");
        const parsed = BoardHeadlineSchema.safeParse(row.headline);
        if (!parsed.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Stored board pack snapshot is not readable" });
        return { id: row.id, name: row.name, windowLabel: row.windowLabel, frozenBy: row.frozenBy, createdAt: row.createdAt.toISOString(), headline: parsed.data };
      }),

    freezeBoardPack: protectedProcedure
      .input(performanceRequestSchema.extend({ name: z.string().trim().min(1).max(255) }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        const { name, ...req } = input;
        const { getCountryPerformance } = await import("./analysis/countryPerformance");
        const pack = await getCountryPerformance({ ...req, refresh: true });
        const row = await db.createBoardPackSnapshot({ country: input.country, name, windowLabel: pack.meta.window.label, headline: pack.headline, frozenBy: ctx.user.name ?? "unknown" });
        return { id: row.id, name: row.name, windowLabel: row.windowLabel, frozenBy: row.frozenBy, createdAt: row.createdAt.toISOString() };
      }),

    deleteBoardSnapshot: protectedProcedure
      .input(z.object({ country: countrySchema, id: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        await db.deleteBoardPackSnapshot(input.id, input.country);
        return { ok: true };
      }),

    presenterNotes: protectedProcedure
      .input(z.object({ country: countrySchema, periodKey: z.string().min(1).max(60) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        const rows = await db.listPresenterNotes(input.country, input.periodKey);
        return rows.map((r) => ({ sectionId: r.sectionId, body: r.body, author: r.author, updatedAt: r.updatedAt.toISOString() }));
      }),

    savePresenterNote: protectedProcedure
      .input(z.object({ country: countrySchema, periodKey: z.string().min(1).max(60), sectionId: z.string().min(1).max(60), body: z.string().max(4000) }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        const row = await db.upsertPresenterNote({ ...input, author: ctx.user.name ?? "unknown" });
        return row ? { sectionId: row.sectionId, body: row.body, author: row.author, updatedAt: row.updatedAt.toISOString() } : null;
      }),

    slideLayout: protectedProcedure.query(async ({ ctx }) => {
      const username = ctx.user.name;
      if (!username) return null;
      const { SlideLayoutSchema } = await import("./analysis/countryPerformance.schemas");
      const stored = await db.getUserPreference(username, "performance.slideLayout");
      const parsed = SlideLayoutSchema.safeParse(stored);
      return parsed.success ? parsed.data : null;
    }),

    saveSlideLayout: protectedProcedure
      .input(z.object({ order: z.array(z.string().min(1).max(60)).max(40), hidden: z.array(z.string().min(1).max(60)).max(40) }))
      .mutation(async ({ ctx, input }) => {
        const username = ctx.user.name;
        if (!username) throw new TRPCError({ code: "FORBIDDEN", message: "No username on session" });
        await db.setUserPreference(username, "performance.slideLayout", input);
        return input;
      }),

    boardPlanBaseline: protectedProcedure
      .input(z.object({ country: countrySchema, year: z.number().int().min(2000).max(2100) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        const row = await db.getBoardPlanBaseline(input.country, input.year);
        const versions = await db.listVersions(input.country);
        return {
          versionId: row?.versionId ?? null,
          setBy: row?.setBy ?? null,
          updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
          versions: versions.map((v) => ({ id: v.id, name: v.name, savedBy: v.savedBy, createdAt: v.createdAt.toISOString() })),
        };
      }),

    setBoardPlanBaseline: protectedProcedure
      .input(z.object({ country: countrySchema, year: z.number().int().min(2000).max(2100), versionId: z.number().int().positive().nullable() }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        if (input.versionId !== null) {
          const version = await db.getVersionById(input.versionId);
          if (!version || version.country !== input.country) throw new TRPCError({ code: "BAD_REQUEST", message: "That version does not belong to this country" });
        }
        await db.setBoardPlanBaseline(input.country, input.year, input.versionId, ctx.user.name ?? "unknown");
        const { invalidateCountryPerformanceCache } = await import("./analysis/countryPerformance");
        invalidateCountryPerformanceCache(input.country);
        return { ok: true };
      }),

    competitorData: protectedProcedure
      .input(z.object({ country: z.string() }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        const data = await db.getCompetitorData(input.country);
        if (!data) return null;
        return {
          brandMonthly: data.brandMonthly,
          brandMonthlyKg: data.brandMonthlyKg,
          flavorYearly: data.flavorYearly,
          flavorYearlyKg: data.flavorYearlyKg,
          uploadedBy: data.uploadedBy,
          uploadedAt: data.uploadedAt?.toISOString() ?? null,
        };
      }),

    updatePlanningFgCell: protectedProcedure
      .input(z.object({
        skuId: z.number(),
        periodId: z.number(),
        label: z.string(),
        value: z.string(),
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
                skuName: z.string().optional(),
        periodLabel: z.string().optional(),
        oldValue: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        await assertRecordsScopedToCountry(input.country, "Planning FG", [{ skuId: input.skuId, periodId: input.periodId }], "Save");
        const fieldMap: Record<string, string> = {
          "Opening Stock": "openingStock",
          "Adjustments": "adjustments",
          "Invoiced (SHP)": "invoiced",
          "Actual arrivals / Planned Orders": "arrivals",
        };
        const field = fieldMap[input.label];
        if (!field) throw new Error(`Unknown label: ${input.label}`);
        const clampedValue = Math.max(0, parseFloat(input.value) || 0).toString();
        await db.upsertCountryPlanningFgCell(input.skuId, input.periodId, { [field]: clampedValue });
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit_cell",
          sheet: "Planning FG",
          skuName: input.skuName,
          periodLabel: input.periodLabel,
          field: input.label,
          oldValue: input.oldValue,
          newValue: clampedValue,
        });
        return { success: true };
      }),

    // Product Expiry Dashboard
    expiryDashboard: protectedProcedure
      .input(z.object({ country: z.enum(["Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getExpiryDashboard(input.country);
      }),

    reorderSkus: adminProcedure
      .input(z.object({
        country: z.enum(["Syria", "Libya", "KSA"]),
        orderedIds: z.array(z.number()),
              }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        await db.reorderCountrySkus(input.country, input.orderedIds);
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "reorder_sku",
          sheet: "SKU",
          details: `Reordered ${input.orderedIds.length} ${input.country} SKUs`,
        });
        return { success: true };
      }),
  }),
  appUsers: router({
    // Verify login from any device - returns user info on success
    verifyLogin: publicProcedure
      .input(z.object({
        username: z.string(),
        password: z.string(),
        country: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await db.ensureOwnerExists("walid", "Walid El Tayeh");
        const logFailure = async () => {
          await db.logAudit({
            username: "anonymous",
            action: "login_failed",
            details: input.country
              ? `Failed login attempt for username: ${input.username} (country: ${input.country})`
              : `Failed login attempt for username: ${input.username}`,
          });
        };
        const logSuccess = async (displayUsername: string) => {
          await db.logAudit({
            username: displayUsername,
            action: "login",
            details: input.country ? `User logged in to ${input.country}` : `User logged in`,
          });
        };
        if (input.country) {
          const result = await db.verifyAppUserLogin(input.username, input.password, input.country);
          if (!result.success || !result.user) {
            await logFailure();
            return { success: false, error: result.error ?? "Invalid credentials" };
          }
          const u = result.user;
          await logSuccess(u.username.toLowerCase());
          await establishAppUserSession(ctx, {
            username: u.username,
            role: u.role,
            isOwner: u.isOwner,
            isPlatformAdmin: db.hasAnyCountryAdmin(u),
          });
          return {
            success: true,
            user: {
              id: u.id,
              username: u.username,
              displayName: u.displayName,
              role: u.role,
              countries: JSON.parse(u.countries) as string[],
              countryRoles: db.parseCountryRoles(u.countryRoles),
              isOwner: u.isOwner,
              email: u.email ?? null,
            },
          };
        }
        const result = await db.verifyAppUserLoginNoCountry(input.username, input.password);
        if (!result.success || !result.user) {
          await logFailure();
          return { success: false, error: result.error ?? "Invalid credentials" };
        }
        const u = result.user;
        await logSuccess(u.username.toLowerCase());
        await establishAppUserSession(ctx, {
          username: u.username,
          role: u.role,
          isOwner: u.isOwner,
          isPlatformAdmin: db.hasAnyCountryAdmin(u),
        });
        return {
          success: true,
          user: {
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            role: u.role,
            countries: JSON.parse(u.countries) as string[],
            countryRoles: db.parseCountryRoles(u.countryRoles),
            isOwner: u.isOwner,
            email: u.email ?? null,
          },
        };
      }),
    // List the workspace owner(s) — accessible to any signed-in caller so the
    // empty "no country access" screen on `CountrySelectorPage` can show real
    // contact info instead of an empty mailto. Returns only safe, non-secret
    // fields (display name + email, never password / role / countries).
    listOwners: protectedProcedure
      .query(async () => {
        return db.listAppOwners();
      }),
    // Change own password - any authenticated user
    changePassword: protectedProcedure
      .input(z.object({
        currentPassword: z.string(),
        newPassword: z.string().min(PASSWORD_MIN_LENGTH).refine(
          (v) => checkPasswordStrength(v).ok,
          { message: PASSWORD_REQUIREMENTS_MESSAGE },
        ),
        confirmPassword: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        if (input.newPassword !== input.confirmPassword) {
          return { success: false, error: "New passwords do not match" };
        }
        // Self-service only: this endpoint always targets the caller's own
        // app-user row, resolved from the session — there is no `userId`
        // field on the input so a caller cannot even express a cross-user
        // change. Knowing another user's current password (e.g. a shared
        // /temporary one) must not be enough to lock that user out via
        // this dialog, and it would also make the audit trail misleading
        // by naming the actor instead of the victim. Owners who legitimately
        // need to reset someone else's password use the owner-only
        // `appUsers.update` path instead.
        const callerUsername = ctx.user.name;
        if (!callerUsername) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No username on session" });
        }
        const caller = await db.getAppUserByUsername(callerUsername);
        if (!caller) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You can only change your own password from this dialog",
          });
        }
        const result = await db.changeAppUserPassword(caller.id, input.currentPassword, input.newPassword);
        if (result.success) {
          // Audit successful self-service password changes so the Audit Trail
          // page can show who changed their own password and when. Failures
          // (wrong current password, etc.) are intentionally not logged here
          // so we don't fill the trail with noise — failed logins already
          // get their own `login_failed` audit entries.
          const actor = ctx.user.name?.trim() || "unknown";
          await db.logAudit({
            username: actor,
            action: "change_password",
            sheet: "Users",
            details: `Changed own password ('${caller.username}' (id=${caller.id}))`,
          });
        }
        return result;
      }),
    // List all users - owner only
    list: protectedProcedure
      .query(async ({ ctx }) => {
        await requireAppOwner(ctx);
        const rows = await db.listAppUsers();
        const recent = await db.getRecentUserAuditChanges(
          rows.map(u => ({ id: u.id, username: u.username }))
        );
        return rows.map(u => {
          const change = recent.get(u.id);
          return {
            id: u.id,
            username: u.username,
            displayName: u.displayName,
            role: u.role,
            countries: JSON.parse(u.countries) as string[],
            countryRoles: db.parseCountryRoles(u.countryRoles),
            isOwner: u.isOwner,
            email: u.email ?? null,
            createdAt: u.createdAt,
            lastChange: change ? {
              username: change.username,
              action: change.action,
              details: change.details ?? null,
              createdAt: change.createdAt,
            } : null,
          };
        });
      }),
    // Create user - owner only
    create: protectedProcedure
      .input(z.object({
        username: z.string().min(2),
        displayName: z.string().min(1),
        password: z.string().min(PASSWORD_MIN_LENGTH).refine(
          (v) => checkPasswordStrength(v).ok,
          { message: PASSWORD_REQUIREMENTS_MESSAGE },
        ),
        role: z.enum(["admin", "viewer"]),
        countries: z.array(z.string()),
        countryRoles: z.record(z.string(), z.enum(["admin", "viewer"])).optional(),
        email: z.string().email().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const requester = await requireAppOwner(ctx);
        const existing = await db.getAppUserByUsername(input.username);
        if (existing) throw new TRPCError({ code: "CONFLICT", message: "Username already exists" });
        await db.createAppUser({
          username: input.username,
          displayName: input.displayName,
          password: input.password,
          role: input.role,
          countries: input.countries,
          countryRoles: input.countryRoles,
          email: input.email ?? null,
        });
        const overrides = input.countryRoles
          ? Object.entries(input.countryRoles)
              .filter(([c]) => input.countries.includes(c))
              .map(([c, r]) => `${c}=${r}`)
              .join(", ")
          : "";
        await db.logAudit({
          username: requester.username,
          action: "create_user",
          sheet: "Users",
          details: `Created user '${input.username}' (${input.role}) with access to ${input.countries.join(", ") || "no countries"}${overrides ? ` [overrides: ${overrides}]` : ""}`,
        });
        return { success: true };
      }),
    // Update user - owner only
    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        displayName: z.string().optional(),
        password: z.string().min(PASSWORD_MIN_LENGTH).refine(
          (v) => checkPasswordStrength(v).ok,
          { message: PASSWORD_REQUIREMENTS_MESSAGE },
        ).optional(),
        role: z.enum(["admin", "viewer"]).optional(),
        countries: z.array(z.string()).optional(),
        countryRoles: z.record(z.string(), z.enum(["admin", "viewer"])).optional(),
        email: z.union([z.string().email(), z.literal("")]).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const requester = await requireAppOwner(ctx);
        const before = await db.getAppUserById(input.id);
        await db.updateAppUser(input.id, {
          displayName: input.displayName,
          password: input.password,
          role: input.role,
          countries: input.countries,
          countryRoles: input.countryRoles,
          ...(input.email !== undefined ? { email: input.email === "" ? null : input.email } : {}),
        });
        const changes: string[] = [];
        if (input.displayName !== undefined && (!before || input.displayName !== before.displayName)) {
          changes.push(`display name '${before?.displayName ?? ""}' → '${input.displayName}'`);
        }
        if (input.password !== undefined) {
          changes.push("password (changed)");
        }
        if (input.role !== undefined && (!before || input.role !== before.role)) {
          changes.push(`role '${before?.role ?? ""}' → '${input.role}'`);
        }
        if (input.countries !== undefined) {
          const oldCountries = before ? (JSON.parse(before.countries) as string[]).join(", ") : "";
          const newCountries = input.countries.join(", ");
          if (oldCountries !== newCountries) {
            changes.push(`countries '${oldCountries || "(none)"}' → '${newCountries || "(none)"}'`);
          }
        }
        if (input.countryRoles !== undefined) {
          const fmt = (m: Record<string, string>) =>
            Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([c, r]) => `${c}=${r}`).join(", ");
          // Diff against what the database would actually store: prune both
          // sides by the country list each side is sanitized against. This
          // keeps the audit trail honest even if `before` carries stale
          // overrides for countries the user is no longer assigned to.
          const beforeCountries = before ? (JSON.parse(before.countries) as string[]) : [];
          const beforeOverridesRaw = before ? db.parseCountryRoles(before.countryRoles) : {};
          const oldMap: Record<string, string> = {};
          for (const [c, r] of Object.entries(beforeOverridesRaw)) {
            if (beforeCountries.includes(c)) oldMap[c] = r;
          }
          const oldOverrides = fmt(oldMap);
          // The new list is whatever `countries` was provided in this request,
          // falling back to the user's prior list if the field was omitted.
          const effectiveCountries = input.countries ?? beforeCountries;
          const newOverridesMap: Record<string, string> = {};
          for (const [c, r] of Object.entries(input.countryRoles)) {
            if (effectiveCountries.includes(c)) newOverridesMap[c] = r;
          }
          const newOverrides = fmt(newOverridesMap);
          if (oldOverrides !== newOverrides) {
            changes.push(`country roles '${oldOverrides || "(none)"}' → '${newOverrides || "(none)"}'`);
          }
        }
        if (input.email !== undefined) {
          const oldEmail = before?.email ?? "";
          const newEmail = input.email === "" || input.email === null ? "" : input.email;
          if (oldEmail !== newEmail) {
            changes.push(`email '${oldEmail || "(none)"}' → '${newEmail || "(none)"}'`);
          }
        }
        const targetTag = before ? `'${before.username}' (id=${input.id})` : `id=${input.id}`;
        await db.logAudit({
          username: requester.username,
          action: "update_user",
          sheet: "Users",
          details: `Updated user ${targetTag}: ${changes.join("; ") || "(no changes)"}`,
        });
        return { success: true };
      }),
    // Delete user - owner only, cannot delete self
    delete: protectedProcedure
      .input(z.object({
        id: z.number(),
      }))
      .mutation(async ({ ctx, input }) => {
        const requester = await requireAppOwner(ctx);
        if (requester.id === input.id) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot delete yourself" });
        const before = await db.getAppUserById(input.id);
        await db.deleteAppUser(input.id);
        const targetTag = before ? `'${before.username}' (id=${input.id})` : `id=${input.id}`;
        await db.logAudit({
          username: requester.username,
          action: "delete_user",
          sheet: "Users",
          details: `Deleted user ${targetTag}`,
        });
        return { success: true };
      }),
  }),

  // ==================== PRESENCE ====================
  presence: router({
    // Heartbeat: called every 30s by logged-in clients to stay "online".
    //
    // Identity (username/displayName) is derived from the authenticated session
    // (`ctx.user`) and the linked app-user record — never from client input —
    // so a logged-in user cannot impersonate someone else in the "online users"
    // widget by passing a different username from the browser.
    heartbeat: protectedProcedure
      .input(z.object({
        country: z.string(),
        currentPage: z.string(),
      }))
      .mutation(async ({ ctx, input }) => {
        const username = ctx.user.name?.trim();
        if (!username) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No username on session" });
        }
        const appUser = await db.getAppUserByUsername(username);
        const displayName = appUser?.displayName?.trim() || username;
        await db.upsertPresence({
          username,
          displayName,
          country: input.country,
          currentPage: input.currentPage,
        });
        return { success: true };
      }),
    // Get all users seen in the last 2 minutes
    online: protectedProcedure.query(async () => {
      return db.getOnlineUsers();
    }),
    // Remove presence on logout. The username is derived from `ctx.user` so
    // a caller cannot evict another user from the online list.
    leave: protectedProcedure
      .mutation(async ({ ctx }) => {
        const username = ctx.user.name?.trim();
        if (!username) {
          throw new TRPCError({ code: "FORBIDDEN", message: "No username on session" });
        }
        await db.removePresence(username);
        return { success: true };
      }),
  }),
  // ==================== FORECAST SPLIT RECOMMENDATION ====================
  forecastSplit: router({
    /**
     * Given a total tonnage, mastercase weight (kg), target month/year, and country,
     * analyse historical IMS data and return per-SKU mastercase recommendations.
     */
    recommend: protectedProcedure
      .input(z.object({
        country: z.string(),
        totalTons: z.number().positive(),
        mastercaseKg: z.number().positive(),
        targetMonth: z.number().min(1).max(12),
        targetYear: z.number().min(2024).max(2032),
        includeNpi: z.boolean().optional().default(true),
        previousMonthContext: z.string().optional(),
        monthPositionInForecast: z.number().optional(),
        totalForecastDuration: z.number().optional(),
        plannerInstructions: z.string().max(2000).optional(),
        // Structured per-SKU adjustments coming from the new UI panel. When provided,
        // they ALWAYS take precedence over (and supplement) the free-text parser.
        skuDirectives: z.array(z.object({
          skuId: z.number().int().positive(),
          action: z.enum(["zero", "reduce", "increase", "cap", "set"]),
          valuePct: z.number().min(0).max(500).optional(),
          valueMC: z.number().min(0).optional(),
        })).optional(),
      }))
      .mutation(async ({ input }) => {
        const { country: countryRaw, totalTons, mastercaseKg, targetMonth, targetYear, includeNpi, previousMonthContext, monthPositionInForecast, totalForecastDuration, plannerInstructions, skuDirectives } = input;
        const country = countryRaw as 'Lebanon' | 'Syria' | 'Libya';

        // 1. Fetch all SKUs for this country, optionally filtering out NPI
        const allSkus = await db.getSkusForCountry(country);
        const skus = includeNpi ? allSkus : allSkus.filter(s => (s.category ?? 'Core') === 'Core');
        if (!skus.length) throw new TRPCError({ code: 'NOT_FOUND', message: includeNpi ? 'No SKUs found for this country' : 'No Core SKUs found for this country (all SKUs are NPI)' });

        // 2. Fetch all IMS data + shipment (production/order) data for this country
        const periods = await db.getPeriodsForCountry(country);
        const imsData = await db.getImsDataForCountry(country);
        const shipmentRows = await db.getShipmentDataForCountry(country);

        // Build orders-by-SKU map: sum of week1..week4 in mastercases per period
        // This represents PRODUCTION/ORDERS placed (the planner's committed intent),
        // even for brand-new SKUs that have no IMS sales history yet.
        const ordersBySku: Record<number, { year: number; month: number; mc: number }[]> = {};
        for (const row of shipmentRows) {
          const period = periods.find(p => p.id === row.periodId);
          if (!period) continue;
          const w1 = parseFloat(row.week1 ?? '0') || 0;
          const w2 = parseFloat(row.week2 ?? '0') || 0;
          const w3 = parseFloat(row.week3 ?? '0') || 0;
          const w4 = parseFloat(row.week4 ?? '0') || 0;
          const mc = w1 + w2 + w3 + w4;
          if (mc <= 0) continue;
          if (!ordersBySku[row.skuId]) ordersBySku[row.skuId] = [];
          ordersBySku[row.skuId].push({ year: period.year, month: period.month, mc });
        }

        // 3. Build per-SKU monthly IMS history
        const skuHistory: Record<number, { name: string; weight: string; category: string; packagingType: string; monthlyIms: { year: number; month: number; value: number }[] }> = {};
        for (const sku of skus) {
          skuHistory[sku.id] = { name: sku.name, weight: sku.weight, category: sku.category ?? 'Core', packagingType: (sku as any).packagingType ?? 'New', monthlyIms: [] };
        }
        for (const row of imsData) {
          const period = periods.find(p => p.id === row.periodId);
          if (!period) continue;
          const val = parseFloat(row.value ?? '0') || 0;
          if (skuHistory[row.skuId]) {
            skuHistory[row.skuId].monthlyIms.push({ year: period.year, month: period.month, value: val });
          }
        }

        // 4. Stock health from the SAME engine that powers the FG tabs / Stock
        // Levels analysis (db.getStockLevelAnalysis): carry-forward closing
        // stock (next month opening = previous month closing), IMS with
        // forecast fallback for future months, and cleared-arrival handling.
        // The recommender previously recomputed each month from its own stored
        // Planning FG row in isolation, so a SKU sitting on 28 weeks of stock
        // TODAY looked like 0 stock in a future target month that had no row —
        // and slipped past the stock gate. Reusing the shared analysis keeps
        // the recommender's view identical to what the planner sees on the FG tabs.
        const stockAnalysis = await db.getStockLevelAnalysis(country as 'Lebanon' | 'Syria' | 'Libya' | 'KSA');
        const stockHealthBySku: Record<number, {
          currentWeeks: number; currentZone: string; trend: string;
          targetMonthWeeks: number; targetMonthZone: string;
          nextMonthWeeks: number; nextMonthZone: string;
          criticalPeriods: string[]; overstockPeriods: string[];
          healthScore: number;
        }> = {};
        // SKUs excluded from the forecast entirely because their projected
        // stock coverage has not yet fallen to the 2-week reorder point.
        const stockGatedSkuIds = new Set<number>();
        const stockGateWeeksBySku: Record<number, number> = {};
        if (stockAnalysis) {
          const periodMeta = stockAnalysis.periodMeta;
          const nowD = new Date();
          const curIdx = periodMeta.findIndex(p => p.year === nowD.getFullYear() && p.month === nowD.getMonth() + 1);
          const targetIdx = periodMeta.findIndex(p => p.year === targetYear && p.month === targetMonth);
          const nextY = targetMonth === 12 ? targetYear + 1 : targetYear;
          const nextM = targetMonth === 12 ? 1 : targetMonth + 1;
          const nextIdx = periodMeta.findIndex(p => p.year === nextY && p.month === nextM);
          for (const ss of stockAnalysis.skuStocks) {
            const weeksAt = (idx: number) => idx >= 0 && idx < ss.weeksOfStock.length ? ss.weeksOfStock[idx] : 0;
            const zoneAt = (idx: number) => idx >= 0 && idx < ss.zones.length ? ss.zones[idx] : 'Unknown';
            const currentW = curIdx >= 0 ? weeksAt(curIdx) : ss.currentWeeks;
            const currentZ = curIdx >= 0 ? zoneAt(curIdx) : ss.currentZone;
            // If the target/next month is outside the analysis horizon, fall
            // back to current coverage so the surfaced stock-health fields
            // match what the gate actually uses (never a misleading 0).
            const targetW = targetIdx >= 0 ? weeksAt(targetIdx) : currentW;
            const nextW = nextIdx >= 0 ? weeksAt(nextIdx) : currentW;
            const criticalPeriods: string[] = [];
            const overstockPeriods: string[] = [];
            ss.zones.forEach((z, i) => {
              const label = periodMeta[i]?.label ?? '';
              if (z === 'Critical' || z === 'Negative' || z === 'Out of Stock') criticalPeriods.push(label);
              else if (z === 'Overstock') overstockPeriods.push(label);
            });
            // Trend: compare first half vs second half avg weeks (capped at 12)
            const mid = Math.floor(ss.weeksOfStock.length / 2);
            const capW = (w: number) => Math.min(Math.abs(w) >= 99 ? (w > 0 ? 12 : -12) : w, 12);
            const firstHalf = ss.weeksOfStock.slice(0, mid).reduce((s, w) => s + capW(w), 0) / (mid || 1);
            const secondHalf = ss.weeksOfStock.slice(mid).reduce((s, w) => s + capW(w), 0) / ((ss.weeksOfStock.length - mid) || 1);
            const trend = secondHalf - firstHalf > 0.5 ? 'improving' : firstHalf - secondHalf > 0.5 ? 'deteriorating' : 'stable';
            stockHealthBySku[ss.id] = {
              currentWeeks: Math.round(currentW * 10) / 10,
              currentZone: currentZ,
              trend,
              targetMonthWeeks: Math.round(targetW * 10) / 10,
              targetMonthZone: targetIdx >= 0 ? zoneAt(targetIdx) : currentZ,
              nextMonthWeeks: Math.round(nextW * 10) / 10,
              nextMonthZone: nextIdx >= 0 ? zoneAt(nextIdx) : currentZ,
              criticalPeriods: criticalPeriods.slice(0, 5),
              overstockPeriods: overstockPeriods.slice(0, 5),
              healthScore: ss.healthScore,
            };
            // HARD STOCK GATE — reorder-point rule: stock is projected forward
            // month by month (carry-forward closing stock drained by IMS, with
            // forecast fallback for future months). An order/forecast for the
            // target month is triggered only when the PROJECTED coverage at
            // that month has fallen to 2 weeks or below. If the projection
            // still shows more than 2 weeks at the target month, the SKU gets
            // ZERO — not a soft reduction. The 99-week sentinel (stock on hand
            // but no demand) also gates. If the target month is outside the
            // planning horizon, gate on current coverage instead.
            const gateWeeks = targetIdx >= 0 ? targetW : currentW;
            if (gateWeeks > 2) {
              stockGatedSkuIds.add(ss.id);
              stockGateWeeksBySku[ss.id] = Math.round(gateWeeks * 10) / 10;
            }
          }
        }
        // 4b. Compute total mastercases available
        const totalKg = totalTons * 1000;
        const totalMastercases = Math.floor(totalKg / mastercaseKg);
        // 5. Deep analytics per SKU
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][targetMonth - 1];
        const skuSummaries = Object.entries(skuHistory).map(([skuIdStr, sku]) => {
          const skuId = parseInt(skuIdStr);
          const sorted = [...sku.monthlyIms].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
          const nonZero = sorted.filter(m => m.value > 0);
          const totalIms = nonZero.reduce((s, m) => s + m.value, 0);
          const avgMonthly = nonZero.length ? totalIms / nonZero.length : 0;
          // 3-month rolling trend: compare last 3 months vs prior 3 months
          const last3 = nonZero.slice(-3).reduce((s, m) => s + m.value, 0) / Math.max(1, Math.min(3, nonZero.length));
          const prior3Arr = nonZero.slice(-6, -3);
          const prior3 = prior3Arr.length ? prior3Arr.reduce((s, m) => s + m.value, 0) / prior3Arr.length : 0;
          const rollingTrend = prior3 > 0 ? ((last3 - prior3) / prior3 * 100).toFixed(1) : 'N/A';
          // YoY for same month
          const sameMonthData = nonZero.filter(m => m.month === targetMonth).sort((a, b) => a.year - b.year);
          const yoyGrowth = sameMonthData.length >= 2
            ? (((sameMonthData[sameMonthData.length-1].value - sameMonthData[sameMonthData.length-2].value) / sameMonthData[sameMonthData.length-2].value) * 100).toFixed(1)
            : 'N/A';
          // Seasonality index for target month (avg of this month / overall avg)
          const sameMonthAvg = sameMonthData.length ? sameMonthData.reduce((s,m)=>s+m.value,0)/sameMonthData.length : 0;
          const seasonalityIndex = avgMonthly > 0 ? (sameMonthAvg / avgMonthly).toFixed(2) : 'N/A';
          // Full monthly history string
          const history = nonZero.map(m => `${m.year}-${String(m.month).padStart(2,'0')}:${m.value}`).join(' ');
          const sameMonthHistory = sameMonthData.map(m => `${m.year}:${m.value}`).join(' ');
          // Confidence score: based on coefficient of variation of same-month share across years
          // Low variance in share = high confidence (stable SKU); high variance = low confidence
          const shareHistory: number[] = [];
          if (sameMonthData.length >= 2) {
            // We'll compute share per year for the target month; need total per year for that month
            // Approximate: use each year's same-month value vs the avg across all SKUs for that year/month
            // We store raw values here; actual share vs total will be computed after grandTotal is known
            // For now store raw values; confidenceScore will be computed after skuSummaries is built
          }
          const nwKey = `${sku.name}|${sku.weight}`;
          const hasDuplicateNameWeight = Object.values(skuHistory).filter(s => `${s.name}|${s.weight}` === nwKey).length > 1;
          const displayName = hasDuplicateNameWeight ? `${sku.name} ${sku.weight} ${sku.packagingType}` : `${sku.name} ${sku.weight}`;

          // Orders/production signal — last 6 months and upcoming 3 months (incl. target)
          const orders = ordersBySku[skuId] ?? [];
          const monthIndex = (y: number, m: number) => y * 12 + (m - 1);
          const targetIdx = monthIndex(targetYear, targetMonth);
          const recentOrders = orders.filter(o => {
            const di = targetIdx - monthIndex(o.year, o.month);
            return di > 0 && di <= 6;
          });
          const upcomingOrders = orders.filter(o => {
            const di = monthIndex(o.year, o.month) - targetIdx;
            return di >= 0 && di < 3;
          });
          const recentOrdersMC = recentOrders.reduce((s, o) => s + o.mc, 0);
          const upcomingOrdersMC = upcomingOrders.reduce((s, o) => s + o.mc, 0);
          const ordersDetail = [...recentOrders, ...upcomingOrders]
            .sort((a, b) => monthIndex(a.year, a.month) - monthIndex(b.year, b.month))
            .map(o => `${o.year}-${String(o.month).padStart(2, '0')}:${Math.round(o.mc)}MC`)
            .join(' ');
          const isNewSkuWithOrders = nonZero.length === 0 && (recentOrdersMC + upcomingOrdersMC) > 0;
          return {
            skuId,
            name: displayName,
            rawName: sku.name,
            rawWeight: sku.weight,
            category: sku.category,
            packagingType: sku.packagingType,
            totalIms,
            avgMonthly: avgMonthly.toFixed(0),
            rollingTrend,
            yoyGrowth,
            seasonalityIndex,
            sameMonthHistory,
            history,
            monthsOfData: nonZero.length,
            sameMonthRawData: sameMonthData,
            recentOrdersMC,
            upcomingOrdersMC,
            ordersDetail,
            isNewSkuWithOrders,
          };
        });
        const grandTotal = skuSummaries.reduce((s, sk) => s + sk.totalIms, 0);
        // Compute per-SKU confidence score based on same-month share variance
        // For each SKU, compute its share of total IMS for each year in the same target month
        // Confidence = 100 - (CV * 100) clamped to [10, 99], where CV = stddev/mean of shares
        // Build per-year totals for target month across all SKUs
        const yearTotalsForTargetMonth: Record<number, number> = {};
        for (const sk of skuSummaries) {
          for (const m of sk.sameMonthRawData) {
            yearTotalsForTargetMonth[m.year] = (yearTotalsForTargetMonth[m.year] ?? 0) + m.value;
          }
        }
        const skuConfidenceScores: Record<string, number> = {};
        for (const sk of skuSummaries) {
          const shares = sk.sameMonthRawData
            .filter(m => (yearTotalsForTargetMonth[m.year] ?? 0) > 0)
            .map(m => m.value / yearTotalsForTargetMonth[m.year]);
          if (shares.length < 2) {
            skuConfidenceScores[sk.name] = sk.monthsOfData >= 6 ? 55 : 30; // low data = low confidence
          } else {
            const mean = shares.reduce((s, v) => s + v, 0) / shares.length;
            const variance = shares.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / shares.length;
            const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
            const score = Math.round(Math.min(99, Math.max(10, (1 - cv) * 100)));
            skuConfidenceScores[sk.name] = score;
          }
        }
        // Compute overall market seasonality for the target month
        const allMonthTotals: Record<number, number[]> = {};
        for (const sku of Object.values(skuHistory)) {
          for (const m of sku.monthlyIms.filter(m => m.value > 0)) {
            if (!allMonthTotals[m.month]) allMonthTotals[m.month] = [];
            allMonthTotals[m.month].push(m.value);
          }
        }
        const overallMonthAvg: Record<number, number> = {};
        for (const [mo, vals] of Object.entries(allMonthTotals)) {
          overallMonthAvg[Number(mo)] = (vals as number[]).reduce((s,v)=>s+v,0)/(vals as number[]).length;
        }
        const overallAvgAllMonths = Object.values(overallMonthAvg).reduce((s,v)=>s+v,0) / Math.max(1, Object.keys(overallMonthAvg).length);
        const marketSeasonalityIndex = overallAvgAllMonths > 0 ? (overallMonthAvg[targetMonth] / overallAvgAllMonths).toFixed(2) : '1.00';
                // 6. Build market intelligence context per country
        const countryIntelligence = (() => {
          const base = {
            Lebanon: {
              marketContext: `Lebanon is one of the highest tobacco-consuming countries globally (ranked 3rd per capita). Hookah is deeply embedded in social culture. The country faces a severe economic crisis since 2019 — USD-priced imports are premium goods. Tobacco consumption paradoxically increased from 32% pre-2019 to 61% in 2024 (stress-driven). Al Fakher is the dominant premium shisha brand, competing primarily with Nakhla (budget, JTI/Egypt), Mazaya (Jordan), and local Lebanese brands.`,
              competitors: `Nakhla (JTI/Egypt) — budget segment, strong in cost-sensitive households. Mazaya (Jordan) — mid-range. Romman (Jordan) — niche. Local Lebanese brands — very low price point. Al Fakher holds the premium segment with ~40% global market share.`,
              economicPressure: `High. Currency devaluation means consumers are price-sensitive. 250g is the dominant retail size. 1kg is primarily for hookah lounges and cafés. Premium SKUs may face substitution pressure from cheaper alternatives.`,
              ramadanFactor: `+35% demand spike in the Ramadan month (night socializing after iftar, extended café hours). Ramadan is the single most important demand driver in Lebanon.`,
              summerFactor: `+20-25% in Jun-Aug (outdoor cafes, tourism, social gatherings on the coast).`,
              winterFactor: `-10-15% in Dec-Feb (reduced outdoor activity, economic pressure).`,
              topFlavorTiers: `Tier 1 (anchor SKUs, always high demand): Double Apple, Mint, Grape with Mint, Blueberry, Watermelon. Tier 2 (strong performers): Peach, Orange Mint, Strawberry, Lemon Mint, Grape. Tier 3 (niche/seasonal): Mango, Coconut, Bubblegum, Rose, Vanilla.`,
              growthOutlook: `Flat to slightly declining in volume due to economic crisis, but premiumization trend supports Al Fakher's position. Double Apple remains the #1 SKU by a wide margin in the Levant.`,
            },
            Syria: {
              marketContext: `Syria is in post-conflict reconstruction with limited import capacity. Strong domestic hookah culture. USD scarcity limits premium imports. Al Fakher is the aspirational premium brand, competing with local Syrian brands and Egyptian Nakhla.`,
              competitors: `Nakhla (JTI/Egypt) — strong budget competitor. Local Syrian brands — very price-competitive. Mazaya (Jordan) — mid-range. Al Fakher holds premium positioning.`,
              economicPressure: `Very high. USD scarcity is a hard constraint on import volumes. 250g is the most accessible size. Lounge/café sector is recovering but still below pre-war levels.`,
              ramadanFactor: `+35% demand spike in the Ramadan month. Night culture during Ramadan is a key driver.`,
              summerFactor: `+15-20% in Jun-Aug (outdoor socializing, recovering café sector).`,
              winterFactor: `-10-15% in Dec-Feb.`,
              topFlavorTiers: `Tier 1: Double Apple (dominant in Syria — anise-apple is the traditional Levantine flavor), Mint, Grape with Mint. Tier 2: Blueberry, Watermelon, Peach, Orange. Tier 3: Strawberry, Lemon, Mango.`,
              growthOutlook: `Recovering. Gradual volume growth as reconstruction progresses. Double Apple is overwhelmingly dominant in Syria — often 40-50% of total volume.`,
            },
            Libya: {
              marketContext: `Libya is an oil-rich but politically unstable North African market. Strong hookah culture with deep roots. Al Fakher competes with Egyptian brands (Nakhla, Eastern Company) which have strong distribution via Egypt-Libya trade routes. Three local Libyan brands (Mars, Tanit, Crystal) dominate cigarettes but hookah is import-driven.`,
              competitors: `Nakhla (JTI/Egypt) — strong competitor with geographic proximity advantage. Eastern Company (Egypt) — bulk supply to Libya. Mazaya (Jordan) — growing presence. Al Fakher holds the premium segment.`,
              economicPressure: `Moderate. Oil revenues support purchasing power but political instability creates supply chain risks. 250g and 1kg both have strong demand.`,
              ramadanFactor: `+40% demand spike — strongest Ramadan effect in North Africa. Extended night socializing, family gatherings.`,
              summerFactor: `+15-20% in Jun-Aug (outdoor culture, Mediterranean summer).`,
              winterFactor: `-5-10% in Dec-Feb (milder than Lebanon/Syria).`,
              topFlavorTiers: `Tier 1: Double Apple, Mint, Grape with Mint, Blueberry. Tier 2: Watermelon, Peach, Orange Mint, Strawberry. Tier 3: Lemon, Mango, Rose.`,
              growthOutlook: `Growing. Libya is an underpenetrated market with upside potential. Al Fakher has strong brand equity. Supply chain reliability is the main constraint.`,
            },
          };
          return base[country as keyof typeof base] ?? base.Lebanon;
        })();

        // 7. Compute Ramadan adjustment for target month
        // Ramadan dates (Hijri calendar, approximate Gregorian overlap):
        // 2024: Mar-Apr (months 3-4). 2025: Mar (month 3). 2026: Feb-Mar (months 2-3). 2027: Jan-Feb (months 1-2). 2028: Jan (month 1). 2029: Dec 2028-Jan 2029 (months 12,1). 2030: Dec 2029-Jan 2030 (months 12,1).
        // NOTE: Ramadan 2026 ends ~Mar 19 2026. April, May, June 2026 are NOT Ramadan.
        const ramadanMonths: Record<number, number[]> = { 2024: [3, 4], 2025: [3], 2026: [2, 3], 2027: [1, 2], 2028: [1], 2029: [1, 12], 2030: [1, 12] };
        const isRamadanMonth = (ramadanMonths[targetYear] ?? []).includes(targetMonth);
        const ramadanBoostPct = isRamadanMonth
          ? (country === 'Libya' ? 40 : 35)
          : 0;
        const ramadanNote = isRamadanMonth
          ? `${monthName} ${targetYear} falls in Ramadan — expect +${ramadanBoostPct}% demand uplift driven by night socializing, extended café hours, and gifting culture. This is the single most important seasonal driver in ${country}.`
          : `${monthName} ${targetYear} is not a Ramadan month. Check for summer (+15-25% Jun-Aug) or winter (-10-15% Dec-Feb) adjustments.`;

        // 7b. Expert seasonal calendar — month-by-month intelligence
        const seasonalCalendar: Record<number, { label: string; effect: string; multiplier: string }> = {
          1:  { label: 'January',   effect: 'Post-holiday restocking. Distributors rebuild inventory after December slowdown. Moderate demand recovery.', multiplier: '0.90-0.95' },
          2:  { label: 'February',  effect: 'Pre-Ramadan stocking begins (if Ramadan is in March). Winter tail-end. Steady demand.', multiplier: '0.92-1.00' },
          3:  { label: 'March',     effect: 'Often Ramadan month (2024-2026). If Ramadan: +35-40% spike. If not: spring transition, gradual demand increase.', multiplier: '1.00-1.40' },
          4:  { label: 'April',     effect: 'Post-Ramadan normalization or late Ramadan. Eid al-Fitr celebrations can sustain elevated demand for 1-2 weeks.', multiplier: '0.95-1.15' },
          5:  { label: 'May',       effect: 'Spring-to-summer transition. Outdoor café season begins. Gradual demand increase.', multiplier: '1.00-1.10' },
          6:  { label: 'June',      effect: 'Summer season starts. Outdoor socializing, tourism, Mediterranean café culture. +15-25% uplift.', multiplier: '1.15-1.25' },
          7:  { label: 'July',      effect: 'Peak summer month. Highest outdoor consumption. Tourism at maximum. Strong demand.', multiplier: '1.20-1.30' },
          8:  { label: 'August',    effect: 'Late summer. Still elevated but beginning to taper. Back-to-school effect in some markets.', multiplier: '1.10-1.20' },
          9:  { label: 'September', effect: 'Summer wind-down. Return to normal consumption patterns. Moderate demand.', multiplier: '0.95-1.05' },
          10: { label: 'October',   effect: 'Autumn. Stable demand. Pre-winter stocking may begin for some distributors.', multiplier: '0.95-1.00' },
          11: { label: 'November',  effect: 'Pre-year-end. Distributors may front-load orders to meet annual targets. Slight uptick possible.', multiplier: '0.95-1.05' },
          12: { label: 'December',  effect: 'YEAR-END CLOSING. Significant slowdown in ordering. Distributors minimize inventory to close books. Holiday period reduces café traffic. -15-25% dip typical. Many distributors place minimal orders.', multiplier: '0.75-0.85' },
        };
        const currentSeasonalInfo = seasonalCalendar[targetMonth];

        // 7c. Year-end closing intelligence
        const isYearEnd = targetMonth === 12;
        const isQ4 = targetMonth >= 10;
        const isJanRestock = targetMonth === 1;
        const yearEndContext = isYearEnd
          ? `\n⚠ YEAR-END CLOSING MONTH (December ${targetYear}):\n- Distributors typically reduce orders by 15-25% to minimize year-end inventory on their books\n- Café and lounge traffic drops during holiday/vacation period\n- Focus on core/anchor SKUs (Double Apple, Mint) — distributors cut NPI and niche flavors first\n- Some distributors may have already front-loaded November orders to meet annual targets\n- Recommend conservative allocation: reduce NPI by 20-30%, maintain Core at 85-90% of normal levels\n- January ${targetYear + 1} will see a restocking bounce — plan accordingly`
          : isQ4
          ? `\nQ4 CONTEXT (${monthName} ${targetYear}):\n- Approaching year-end. Distributors may adjust ordering patterns to manage annual inventory targets.\n- ${targetMonth === 11 ? 'November often sees front-loading of orders before December slowdown.' : 'October is typically stable with normal ordering patterns.'}\n- Monitor distributor behavior for early signs of year-end inventory reduction.`
          : isJanRestock
          ? `\nJANUARY RESTOCKING (${targetYear}):\n- Post year-end restocking period. Distributors rebuild depleted inventory from December slowdown.\n- Expect 10-15% above-normal ordering as pipeline refills.\n- Good opportunity to push NPI SKUs as distributors are open to refreshing their product mix.\n- Anchor SKUs (Double Apple, Mint) will see strongest restocking demand.`
          : '';

        // 7d. Progressive month-over-month context (for multi-month forecasts)
        const progressiveContext = previousMonthContext
          ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nSECTION F: PROGRESSIVE CONTEXT — PREVIOUS MONTH RECOMMENDATIONS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nThis is month ${monthPositionInForecast ?? '?'} of ${totalForecastDuration ?? '?'} in a multi-month forecast.\nThe previous month\'s AI-recommended split was:\n${previousMonthContext}\n\nIMPORTANT PROGRESSIVE RULES:\n- Maintain momentum: if a SKU was trending up last month, continue the trajectory unless seasonal factors change\n- Smooth transitions: avoid >15% month-over-month swings in any single SKU\'s share unless justified by Ramadan/year-end/seasonal shift\n- Depletion curves: if stock was critical last month and you boosted allocation, check if the boost was sufficient or needs continuation\n- Seasonal transitions: if moving from summer→autumn or autumn→winter, gradually reduce seasonal SKUs rather than cliff-dropping\n- Year-end approach: if approaching December, start gradually reducing NPI allocations from October onwards\n- Post-Ramadan: if last month was Ramadan, normalize allocations but don\'t crash — Eid celebrations sustain demand for 1-2 weeks`
          : '';

        // 8. Pre-compute algorithmic base scores per SKU (5-factor weighted model)
        // Factor weights: Historical trend 35%, Seasonality 25%, Stock health 20%, Market intel 10%, Confidence 10%
        const skuBaseScores: Record<string, number> = {};
        let totalBaseScore = 0;
        for (const sk of skuSummaries) {
          const conf = skuConfidenceScores[sk.name] ?? 50;
          const skuObj = skus.find(s => s.id === sk.skuId);
          const health = skuObj ? stockHealthBySku[skuObj.id] : null;

          // Factor 1: Historical trend score (35%) — based on avg monthly IMS relative to total.
          // FALLBACK for SKUs with zero IMS but with active orders (new SKU just added by planner):
          // use their share of recent+upcoming orders as a proxy demand signal so they aren't allocated 0.
          let historicalShare: number;
          if (sk.totalIms > 0 && grandTotal > 0) {
            historicalShare = sk.totalIms / grandTotal;
          } else if (sk.isNewSkuWithOrders) {
            const allOrdersTotal = skuSummaries.reduce((s, x) => s + x.recentOrdersMC + x.upcomingOrdersMC, 0);
            const skuOrders = sk.recentOrdersMC + sk.upcomingOrdersMC;
            historicalShare = allOrdersTotal > 0 ? (skuOrders / allOrdersTotal) : (1 / Math.max(1, skuSummaries.length));
          } else {
            historicalShare = grandTotal > 0 ? (sk.totalIms / grandTotal) : (1 / Math.max(1, skuSummaries.length));
          }
          const trendMultiplier = (() => {
            const rt = parseFloat(String(sk.rollingTrend));
            if (isNaN(rt)) return 1.0;
            if (rt > 20) return 1.15;
            if (rt > 10) return 1.08;
            if (rt > 0) return 1.03;
            if (rt > -10) return 0.97;
            if (rt > -20) return 0.92;
            return 0.85;
          })();
          const f1 = historicalShare * trendMultiplier * 0.35;

          // Factor 2: Seasonality score (25%) — SKU-specific seasonality index
          const si = parseFloat(String(sk.seasonalityIndex));
          const seasonalityMultiplier = isNaN(si) ? 1.0 : Math.min(2.0, Math.max(0.5, si));
          const f2 = historicalShare * seasonalityMultiplier * 0.25;

          // Factor 3: Stock health score (20%) — critical = boost, overstock = reduce
          const stockMultiplier = (() => {
            if (!health) return 1.0;
            const zone = health.targetMonthZone;
            if (zone === 'Critical' || zone === 'Negative' || zone === 'Out of Stock') return 1.20;
            if (zone === 'Overstock') return 0.82;
            return 1.0;
          })();
          const f3 = historicalShare * stockMultiplier * 0.20;

          // Factor 4: Market intelligence score (10%) — SKU tier ranking
          const skuNameLower = sk.name.toLowerCase();
          const tierMultiplier = (() => {
            // Tier 1 anchor SKUs
            if (skuNameLower.includes('double apple') || skuNameLower.includes('two apple')) return 1.15;
            if (skuNameLower.includes('mint') && !skuNameLower.includes('grape') && !skuNameLower.includes('orange') && !skuNameLower.includes('lemon') && !skuNameLower.includes('blue')) return 1.10;
            if (skuNameLower.includes('grape') && skuNameLower.includes('mint')) return 1.08;
            if (skuNameLower.includes('blueberry') || skuNameLower.includes('blue berry')) return 1.05;
            if (skuNameLower.includes('watermelon')) return 1.03;
            // Tier 2
            if (skuNameLower.includes('peach') || skuNameLower.includes('orange') || skuNameLower.includes('strawberry') || skuNameLower.includes('lemon') || skuNameLower.includes('grape')) return 1.0;
            // Tier 3 / NPI
            return 0.95;
          })();
          const f4 = historicalShare * tierMultiplier * 0.10;

          // Factor 5: Confidence score (10%)
          const f5 = historicalShare * (conf / 100) * 0.10;

          let baseScore = f1 + f2 + f3 + f4 + f5;
          // HARD STOCK GATE: projected coverage at the target month still
          // above the 2-week reorder point → zero base
          // score so the SKU gets no allocation and its share flows to
          // eligible SKUs during normalization.
          if (skuObj && stockGatedSkuIds.has(skuObj.id)) baseScore = 0;
          skuBaseScores[sk.name] = baseScore;
          totalBaseScore += baseScore;
        }
        // Normalize base scores to get base allocation percentages
        const skuBaseAllocPct: Record<string, number> = {};
        for (const sk of skuSummaries) {
          skuBaseAllocPct[sk.name] = totalBaseScore > 0 ? (skuBaseScores[sk.name] / totalBaseScore) * 100 : (100 / skuSummaries.length);
        }

        // 8b. Parse free-text planner instructions into structured directives.
        // We use a small dedicated LLM pass that returns JSON mapping directives → exact SKU IDs.
        // These directives are then enforced DETERMINISTICALLY after the main recommend pass,
        // so the planner's intent is honored even if the main LLM ignores Section in the prompt.
        type PlannerDirective = {
          skuIds: number[];
          action: 'zero' | 'reduce' | 'increase' | 'cap' | 'set' | 'prioritize';
          valuePct?: number;
          valueMC?: number;
          raw: string;
        };
        let parsedDirectives: PlannerDirective[] = [];
        const hasLlmKeyForParse = !!(process.env.BUILT_IN_FORGE_API_KEY && process.env.BUILT_IN_FORGE_API_KEY.trim());

        // 8b.0 — Structured directives from the per-SKU adjustment UI panel.
        // These are explicit and unambiguous — the planner clicked exact actions on
        // exact SKUs, so they always take precedence and skip the parsers.
        if (skuDirectives && skuDirectives.length > 0) {
          const validIds = new Set(skus.map(s => s.id));
          for (const d of skuDirectives) {
            if (!validIds.has(d.skuId)) continue;
            const sk = skus.find(s => s.id === d.skuId)!;
            parsedDirectives.push({
              skuIds: [d.skuId],
              action: d.action,
              valuePct: d.valuePct,
              valueMC: d.valueMC,
              raw: `[UI] ${sk.name} ${sk.weight} (${(sk as any).packagingType ?? 'New'}) → ${d.action}${d.valuePct ? ` ${d.valuePct}%` : ''}${d.valueMC !== undefined ? ` ${d.valueMC}MC` : ''}`,
            });
          }
          if (parsedDirectives.length > 0) {
            console.log(`[ForecastSplit] UI panel sent ${parsedDirectives.length} structured directive(s):`,
              parsedDirectives.map(d => `${d.action}${d.valuePct ? ' '+d.valuePct+'%' : ''}${d.valueMC !== undefined ? ' '+d.valueMC+'MC' : ''} → SKU ${d.skuIds[0]}`).join(' | '));
          }
        }

        // 8b.1 — Regex-based parser (fast, deterministic). Handles the most common patterns
        // without needing an LLM. Sentences are split by newlines, commas, semicolons, or " and ".
        if (plannerInstructions && plannerInstructions.trim().length > 0) {
          const text = plannerInstructions.trim();
          // Split only on hard sentence boundaries and action-VERB starts that always
          // begin a directive. "zero", "set", and "skip" are excluded because they
          // commonly appear mid-sentence (e.g. "reduce X to zero", "set to 0").
          const sentences = text
            .split(/\n+|(?:^|[\s,;])(?=(?:reduce|increase|boost|raise|lower|cut|cap|prioriti[sz]e|don'?t|do not)\b)|,\s+|;\s+| and (?=(?:reduce|increase|boost|raise|lower|cut|cap|prioriti[sz]e|skip|zero|set|don'?t|do not)\b)/i)
            .map(s => s.trim())
            .filter(s => s.length > 0);

          const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
          const skuIndex = skus.map(s => ({
            id: s.id,
            nameLow: norm(s.name),
            weightLow: norm(s.weight),
            packLow: norm(((s as any).packagingType ?? 'New')),
          }));

          const findMatchingSkus = (sentence: string): number[] => {
            const sLow = norm(sentence);
            // weight token: "50g", "1kg", "250 g", "1 kg"
            const weightMatch = sLow.match(/(\d+(?:\.\d+)?)\s*(g|kg|gm|gr)\b/);
            const weightWanted = weightMatch ? `${weightMatch[1]}${weightMatch[2] === 'kg' ? 'kg' : 'g'}` : null;
            // packaging: old/new, with optional "package"/"pkg"/"packaging"
            let packWanted: 'old' | 'new' | null = null;
            if (/\bold\s*(pkg|pack(?:age|aging)?)?\b/.test(sLow)) packWanted = 'old';
            else if (/\bnew\s*(pkg|pack(?:age|aging)?)?\b/.test(sLow)) packWanted = 'new';

            // Score each SKU: name must appear in sentence (longest contiguous match wins)
            const matches: { id: number; score: number }[] = [];
            for (const sk of skuIndex) {
              if (!sk.nameLow) continue;
              if (!sLow.includes(sk.nameLow)) continue;
              let score = sk.nameLow.length;
              if (weightWanted) {
                const wn = norm(sk.weightLow).replace(/\s+/g, '');
                if (wn !== weightWanted.replace(/\s+/g, '')) continue;
                score += 50;
              }
              if (packWanted) {
                if (sk.packLow !== packWanted) continue;
                score += 20;
              }
              matches.push({ id: sk.id, score });
            }
            if (matches.length === 0) return [];
            // Keep only matches with the highest name length (most specific name match)
            const maxNameLen = Math.max(...matches.map(m => {
              const sk = skuIndex.find(x => x.id === m.id)!;
              return sk.nameLow.length;
            }));
            let topNameMatches = matches.filter(m => {
              const sk = skuIndex.find(x => x.id === m.id)!;
              return sk.nameLow.length === maxNameLen;
            });
            // When the planner did not specify packaging and multiple variants remain
            // (e.g. Old + New 1kg both match), prefer "New" — that is the standard
            // assumption per the prompt rules.
            if (!packWanted && topNameMatches.length > 1) {
              const newOnly = topNameMatches.filter(m => {
                const sk = skuIndex.find(x => x.id === m.id)!;
                return sk.packLow === 'new';
              });
              if (newOnly.length > 0) topNameMatches = newOnly;
            }
            return topNameMatches.map(m => m.id);
          };

          for (const sentence of sentences) {
            const sLow = norm(sentence);
            let action: PlannerDirective['action'] | null = null;
            let valuePct: number | undefined;
            let valueMC: number | undefined;

            const pctMatch = sLow.match(/by\s+(\d+(?:\.\d+)?)\s*%/) || sLow.match(/(\d+(?:\.\d+)?)\s*%/);
            const mcMatch = sLow.match(/at\s+(\d+(?:\.\d+)?)\s*(?:mc|mastercases?)?/);

            if (/\b(zero|skip|don'?t|do not|no allocation|set\s+(?:it\s+)?to\s+0|to\s+zero|to\s+0)\b/.test(sLow)) {
              action = 'zero';
            } else if (/\b(cap|maximum|max)\b/.test(sLow) && mcMatch) {
              action = 'cap';
              valueMC = parseFloat(mcMatch[1]);
            } else if (/\b(reduce|lower|cut|decrease|drop)\b/.test(sLow)) {
              action = 'reduce';
              valuePct = pctMatch ? parseFloat(pctMatch[1]) : 20;
            } else if (/\b(increase|boost|raise|grow|push)\b/.test(sLow)) {
              action = 'increase';
              valuePct = pctMatch ? parseFloat(pctMatch[1]) : 25;
            } else if (/\b(prioritize|prioritise|focus on|favor|favour)\b/.test(sLow)) {
              action = 'prioritize';
            }

            if (!action) continue;
            const skuIds = findMatchingSkus(sentence);
            if (skuIds.length === 0) continue;
            parsedDirectives.push({ skuIds, action, valuePct, valueMC, raw: sentence });
          }

          if (parsedDirectives.length > 0) {
            console.log(`[ForecastSplit] Regex parser found ${parsedDirectives.length} directive(s):`,
              parsedDirectives.map(d => `${d.action}${d.valuePct ? ' '+d.valuePct+'%' : ''}${d.valueMC ? ' cap '+d.valueMC : ''} → SKUs ${d.skuIds.join(',')}`).join(' | '));
          }
        }

        // 8b.2 — LLM parser as supplementary pass (only if regex found nothing).
        if (parsedDirectives.length === 0 && plannerInstructions && plannerInstructions.trim().length > 0 && hasLlmKeyForParse) {
          const skuList = skus.map(s => `${s.id}|${s.name}|${s.weight}|${(s as any).packagingType ?? 'New'}`).join('\n');
          const parsePrompt = `You are parsing a demand planner's free-text instructions into structured JSON directives.

AVAILABLE SKUs (format: id|name|weight|packagingType):
${skuList}

PLANNER INSTRUCTIONS:
"""
${plannerInstructions.trim()}
"""

Output JSON ONLY in this exact shape:
{
  "directives": [
    {
      "skuIds": [int, ...],         // ids from the SKU list above that match this directive
      "action": "zero"|"reduce"|"increase"|"cap"|"prioritize",
      "valuePct": number,           // for reduce/increase: percent (e.g. 20 for "by 20%"). Default 100 for "to zero"; default 25 for "boost"/"increase" without %.
      "valueMC": number,            // for cap: the maximum mastercases
      "raw": string                 // the exact directive snippet you parsed
    }
  ]
}

MATCHING RULES (apply carefully):
- Match by name (case-insensitive, partial allowed). If the planner specifies a weight (e.g. "50g", "1kg", "250g"), match only that weight.
- If the planner specifies a packaging type ("Old" or "New" or "Old package"/"New package"), match only that packaging.
- "Double Apple Old package 50g" → match SKU named Double Apple, weight 50g, packaging Old. Return that ONE id.
- "Double Apple 1kg" → match SKU named Double Apple, weight 1kg (any packaging if not specified, but prefer New).
- "Mint" alone (no weight) → match all Mint SKUs (could be multiple ids).
- "Reduce X to zero" / "Skip X" / "Don't allocate to X" / "Zero X" → action "zero".
- "Reduce X by 20%" → action "reduce", valuePct 20.
- "Increase X" / "Boost X" / "Prioritize X" without % → action "increase", valuePct 25.
- "Increase X by 30%" → action "increase", valuePct 30.
- "Cap X at 500 MC" → action "cap", valueMC 500.
- If a directive does not clearly match any SKU, omit it (do not guess).
- Preserve order of directives as the planner wrote them.
Return ONLY the JSON object, no markdown, no commentary.`;

          try {
            const parseResp = await invokeLLM({
              messages: [
                { role: 'system', content: 'You are a precise JSON parser. Return only valid JSON matching the requested schema.' },
                { role: 'user', content: parsePrompt },
              ],
              response_format: { type: 'json_object' },
            });
            const raw = parseResp.choices[0].message.content;
            const txt = typeof raw === 'string' ? raw : JSON.stringify(raw);
            const obj = JSON.parse(txt);
            if (Array.isArray(obj?.directives)) {
              const validSkuIds = new Set(skus.map(s => s.id));
              parsedDirectives = obj.directives
                .map((d: any) => ({
                  skuIds: Array.isArray(d.skuIds) ? d.skuIds.filter((id: any) => validSkuIds.has(Number(id))).map(Number) : [],
                  action: ['zero', 'reduce', 'increase', 'cap', 'prioritize'].includes(d.action) ? d.action : null,
                  valuePct: typeof d.valuePct === 'number' ? d.valuePct : undefined,
                  valueMC: typeof d.valueMC === 'number' ? d.valueMC : undefined,
                  raw: typeof d.raw === 'string' ? d.raw : '',
                }))
                .filter((d: any) => d.action && d.skuIds.length > 0);
            }
          } catch (parseErr: any) {
            console.warn('[ForecastSplit] Planner-instructions parse failed:', parseErr?.message);
          }
        }

        // 9. Call LLM for intelligent split with deep market intelligence
        const directivesSummary = parsedDirectives.length > 0
          ? '\nPARSED DIRECTIVES (will be ENFORCED deterministically after your output):\n' + parsedDirectives.map(d => {
              const targetSkus = d.skuIds
                .map(id => skus.find(s => s.id === id))
                .filter(Boolean)
                .map(s => `${s!.name} ${s!.weight} (${(s as any).packagingType ?? 'New'})`)
                .join('; ');
              const detail = d.action === 'zero' ? 'set to 0 MC'
                : d.action === 'reduce' ? `reduce by ${d.valuePct ?? 20}%`
                : d.action === 'increase' ? `increase by ${d.valuePct ?? 25}%`
                : d.action === 'cap' ? `cap at ${d.valueMC ?? 0} MC`
                : d.action === 'set' ? `set to exactly ${d.valueMC ?? 0} MC`
                : 'prioritize (above-base allocation)';
              return `  • [${d.action.toUpperCase()}] ${targetSkus} → ${detail}  (raw: "${d.raw}")`;
            }).join('\n')
          : '';

        const plannerInstructionsBlock = (plannerInstructions && plannerInstructions.trim().length > 0)
          ? `\n═══════════════════════════════════════════════════════════════\n⚠ MANDATORY PLANNER INSTRUCTIONS (HIGHEST PRIORITY — OVERRIDES ALL OTHER LOGIC)\n═══════════════════════════════════════════════════════════════\nThe demand planner has provided the following explicit instructions for THIS forecast. You MUST honor them. They override historical trends, seasonality models, market intelligence, and base allocations. If an instruction conflicts with stock health (e.g. planner says "reduce X" but X is critical), still apply the planner's directive and surface the conflict in the warnings array.\n\nPLANNER SAYS:\n"""\n${plannerInstructions.trim()}\n"""\n${directivesSummary}\n\nHOW TO APPLY:\n- Parse each directive carefully. Match SKU names case-insensitively and tolerate minor variations (e.g. "Mint" matches "Mint 250g" and "Mint 1kg" unless a weight is specified).\n- "Reduce X by N%" → cut X's allocation by N% from its base; redistribute the freed mastercases to other SKUs proportionally to their base allocation (excluding any SKU the planner said to reduce/skip).\n- "Increase X by N%" or "Boost X" → raise X's allocation; take from non-priority SKUs.\n- "Skip X" / "Don't allocate to X" / "Zero X" → set X's recommendedMastercases to 0 and redistribute.\n- "Cap X at N MC" → ensure X.recommendedMastercases ≤ N.\n- "Prioritize Y" → give Y above-base allocation.\n- For each SKU affected by a planner directive, in its "reasoning" field explicitly cite the directive (e.g. "Reduced by 20% per planner instruction.") and set "primaryDriver" to "market_intel".\n- In overallInsight, include a sentence summarizing which planner directives were applied.\n- In warnings, flag any directive that creates a stock-out risk or conflicts with critical stock health.\n- The total must still sum to EXACTLY ${totalMastercases}.\n═══════════════════════════════════════════════════════════════\n`
          : '';

        const prompt = `You are acting as a SENIOR FMCG DEMAND PLANNER and DATA ANALYST for Al Fakher tobacco products in ${country}. Your analysis must reflect deep knowledge of the shisha tobacco market, cultural consumption patterns, competitive dynamics, and supply chain constraints.

═══════════════════════════════════════════════════════════════
MISSION: Recommend how to split ${totalMastercases} mastercases (${totalTons} tons, ${mastercaseKg}kg each) across all SKUs for ${monthName} ${targetYear}.
═══════════════════════════════════════════════════════════════
${plannerInstructionsBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION A: COUNTRY MARKET INTELLIGENCE — ${country}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Market Context: ${countryIntelligence.marketContext}
Competitive Landscape: ${countryIntelligence.competitors}
Economic Pressure: ${countryIntelligence.economicPressure}
Ramadan Effect: ${countryIntelligence.ramadanFactor}
Summer Effect: ${countryIntelligence.summerFactor}
Winter Effect: ${countryIntelligence.winterFactor}
SKU Flavor Tiers (global + regional preference): ${countryIntelligence.topFlavorTiers}
Growth Outlook: ${countryIntelligence.growthOutlook}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION B: SEASONAL & RAMADAN ANALYSIS FOR ${monthName} ${targetYear}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${ramadanNote}
Market seasonality index for ${monthName} (from historical IMS data): ${marketSeasonalityIndex}
(1.0 = average month, >1.0 = above average demand, <1.0 = below average demand)

EXPERT SEASONAL CALENDAR for ${monthName}:
- Effect: ${currentSeasonalInfo.effect}
- Expected multiplier range: ${currentSeasonalInfo.multiplier}x of average month
${isRamadanMonth ? `⚠ RAMADAN MONTH DETECTED: Apply +${ramadanBoostPct}% demand uplift to Tier 1 SKUs (Double Apple, Mint, Grape with Mint). Traditional flavors spike during Ramadan. Fruity/exotic flavors also benefit but less so.` : ''}
${yearEndContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION C: ALGORITHMIC BASE ALLOCATION (5-Factor Model)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed base allocation percentages (use as starting point, adjust with your analysis):
${skuSummaries.map(s => `  ${s.name}: ${skuBaseAllocPct[s.name].toFixed(1)}% base → ${Math.round(totalMastercases * skuBaseAllocPct[s.name] / 100)} mastercases`).join('\n')}
Factors used: Historical trend (35%) + Seasonality (25%) + Stock health (20%) + Market intel/flavor tier (10%) + Confidence (10%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION D: PER-SKU DETAILED ANALYTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total historical IMS: ${grandTotal.toFixed(0)} mastercases | Data depth: ${Math.max(...Object.values(skuHistory).map(s => s.monthlyIms.length))} months
${skuSummaries.map(s => {
  const skuObj = skus.find(sk => sk.id === s.skuId);
  const health = skuObj ? stockHealthBySku[skuObj.id] : null;
  const conf = skuConfidenceScores[s.name] ?? 50;
  const baseAlloc = skuBaseAllocPct[s.name]?.toFixed(1) ?? 'N/A';
  const orderLine = (s.recentOrdersMC + s.upcomingOrdersMC) > 0
    ? `  ORDERS/PRODUCTION (planner committed): last 6mo=${Math.round(s.recentOrdersMC)}MC | upcoming 3mo=${Math.round(s.upcomingOrdersMC)}MC | detail: ${s.ordersDetail || 'none'}`
    : `  ORDERS/PRODUCTION: no recent or upcoming orders placed`;
  const newSkuFlag = s.isNewSkuWithOrders
    ? `  🆕 NEW SKU WITH ACTIVE ORDERS — zero IMS history but planner has committed ${Math.round(s.recentOrdersMC + s.upcomingOrdersMC)}MC of orders. ALLOCATE BASED ON ORDER VOLUME, NOT ZERO.`
    : '';
  return [
    `▸ SKU [ID:${s.skuId}] name="${s.name}" weight="${s.rawWeight}" packaging="${s.packagingType}" category="${s.category}" | Base alloc: ${baseAlloc}% | Confidence: ${conf}%`,
    `  IMS: avg/month=${s.avgMonthly} | total=${s.totalIms.toFixed(0)} | months of data=${s.monthsOfData}`,
    `  Trend: 3-month rolling vs prior 3 months: ${s.rollingTrend}% | YoY same month: ${s.yoyGrowth}%`,
    `  Seasonality index for ${monthName}: ${s.seasonalityIndex} | Same month prior years: ${s.sameMonthHistory || 'no data'}`,
    `  Full monthly history: ${s.history || 'no data'}`,
    orderLine,
    newSkuFlag,
    health ? `  STOCK HEALTH: Now=${health.currentWeeks}wks [${health.currentZone}] | ${monthName}=${health.targetMonthWeeks}wks [${health.targetMonthZone}] | Next=${health.nextMonthWeeks}wks [${health.nextMonthZone}] | Health score=${health.healthScore}% | Trend=${health.trend}` : '  STOCK HEALTH: No Planning FG data available',
    stockGatedSkuIds.has(s.skuId) ? `  ⛔ STOCK GATE: projected stock coverage at the target month is still above the 2-week reorder point — this SKU MUST receive recommendedMastercases: 0. Do not allocate anything to it.` : '',
    health && health.criticalPeriods.length > 0 ? `  ⚠ CRITICAL STOCK PERIODS: ${health.criticalPeriods.join(', ')} — MUST increase allocation` : '',
    health && health.overstockPeriods.length > 0 ? `  ⚠ OVERSTOCK PERIODS: ${health.overstockPeriods.join(', ')} — MUST reduce allocation` : '',
  ].filter(Boolean).join('\n');
}).join('\n\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION E: DECISION FRAMEWORK — APPLY IN THIS ORDER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
0. HARD STOCK GATE (absolute rule, overrides EVERYTHING below including the new-SKU safeguard): any SKU marked "⛔ STOCK GATE" in Section D still has more than 2 weeks of PROJECTED stock coverage at the target month (stock carried forward and drained by IMS month by month — an order is only triggered once coverage falls to 2 weeks or below) and MUST receive recommendedMastercases: 0 and sharePercent: 0. Redistribute its volume to non-gated SKUs. In its "reasoning", state that projected coverage has not yet reached the 2-week reorder point.
1. STOCK HEALTH OVERRIDE (highest priority after the hard gate): SKUs in Critical/Negative/Out-of-Stock zones MUST receive +15-25% above base allocation. SKUs in Overstock zones MUST receive -10-20% below base allocation. This is non-negotiable.
2. RAMADAN/SEASONAL ADJUSTMENT: ${isRamadanMonth ? `Apply +${ramadanBoostPct}% uplift to Tier 1 SKUs (Double Apple, Mint, Grape with Mint). Distribute the extra volume from overstocked/declining SKUs.` : 'Apply seasonal index adjustments. Summer months boost fruity SKUs; winter months reduce overall demand.'}
3. TREND MOMENTUM: SKUs with >+10% rolling trend deserve above-base allocation. SKUs with >-10% rolling trend should be reduced below base.
4. MARKET INTELLIGENCE: Double Apple is the anchor SKU in ${country} — never allocate below 25% of its historical share unless severely overstocked. Mint is the universal mixer — maintain consistent supply. NPI SKUs with <6 months data should be allocated conservatively (max 5% above base) unless early data shows exceptional traction.
5. COMPETITIVE CONTEXT: In ${country}, Al Fakher competes primarily with ${country === 'Lebanon' ? 'Nakhla and Mazaya' : country === 'Syria' ? 'Nakhla and local Syrian brands' : 'Nakhla and Eastern Company Egypt'}. Premium SKUs (Tier 1) should be prioritized as they are harder for competitors to match.
6. YEAR-END / Q4 ADJUSTMENT: ${isYearEnd ? 'THIS IS DECEMBER — apply year-end closing logic: reduce NPI by 20-30%, maintain Core at 85-90% of normal. Distributors are minimizing inventory.' : isQ4 ? `Q4 month — be aware of approaching year-end patterns. ${targetMonth === 11 ? 'November may see front-loading before December slowdown.' : 'October is typically stable.'}` : isJanRestock ? 'JANUARY RESTOCKING — expect above-normal demand as distributors rebuild after December. Good time for NPI push.' : 'No special year-end adjustment needed for this month.'}
7. SMOOTH TRANSITIONS: ${previousMonthContext ? 'This is part of a multi-month forecast. Avoid >15% month-over-month swings in any SKU share unless justified by seasonal shift, Ramadan, or year-end closing.' : 'Single month forecast — optimize for this month independently.'}
8. NEW SKU SAFEGUARD (mandatory — read carefully): A SKU flagged "🆕 NEW SKU WITH ACTIVE ORDERS" has zero IMS sales history because it was only just launched, but the planner has already committed production/shipment orders for it. NEVER allocate 0 to such a SKU — UNLESS it is also marked "⛔ STOCK GATE" (rule 0 wins: projected coverage above the 2-week reorder point means no new volume). Treat the orders volume (last 6mo + upcoming 3mo) as the strongest possible intent signal — the planner has put real money behind these SKUs. Allocate at least proportional to their share of total committed orders across all SKUs, and apply seasonal/Ramadan multipliers on top. If a SKU has both IMS history AND orders, weight orders as a forward-looking intent signal that complements (does not replace) IMS history. If a SKU has IMS history but no orders, allocate using the LLM's normal trend/seasonality/stock-health logic. If a SKU has NO IMS and NO orders, it may legitimately receive a very small or zero allocation.
9. BALANCE: Ensure the sum of all recommendedMastercases equals EXACTLY ${totalMastercases}. Round to whole numbers.

${progressiveContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED OUTPUT FORMAT (valid JSON only, no markdown):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 MANDATORY OUTPUT SCHEMA — COVERAGE RULE 🔴
The "recommendations" array MUST contain EXACTLY ${skus.length} entries — one row for every active SKU listed in Section D, identified by its skuId. No skips. No duplicates. No invented SKUs. If a SKU truly should receive 0 mastercases, STILL emit its row with recommendedMastercases: 0 and explain why in "reasoning". Returning fewer than ${skus.length} rows is a hard failure and your response will be rejected.

Required SKU ids — every one of these MUST appear once in your output (in any order):
${skus.map(s => `  ${s.id} — ${s.name} ${s.weight} (${(s as any).packagingType ?? 'New'})`).join('\n')}

{
  "recommendations": [
    {
      "skuId": number (REQUIRED — the exact numeric ID from the SKU header above, e.g. ID:150011. Do NOT make up IDs. Do NOT omit this field. The SKU id is the ONLY reliable way to match your output back to the planner's directives.),
      "skuName": string,
      "weight": string,
      "category": string,
      "packagingType": string ("Old" or "New" — the packaging type for this SKU),
      "recommendedMastercases": number (integer, sum must equal ${totalMastercases}),
      "sharePercent": number (sum must equal 100.0),
      "reasoning": string (2-3 sentences: cite specific data — IMS trend, stock health zone, seasonality index, market intel),
      "trend": "growing" | "stable" | "declining" | "new",
      "seasonalityNote": string (specific note on ${monthName} seasonality for this SKU, including Ramadan/summer/winter effect if applicable),
      "stockAlert": "critical" | "healthy" | "overstock" | "unknown",
      "confidenceScore": number (0-100, adjust from base confidence using trend consistency + stock health clarity + data depth),
      "primaryDriver": string (the single most important factor driving this recommendation: one of "stock_critical" | "stock_overstock" | "ramadan_uplift" | "summer_peak" | "winter_dip" | "trend_growth" | "trend_decline" | "historical_share" | "market_intel" | "low_data". IMPORTANT: Only use "ramadan_uplift" if the target month is actually a Ramadan month — ${isRamadanMonth ? `${monthName} ${targetYear} IS a Ramadan month` : `${monthName} ${targetYear} is NOT a Ramadan month, do NOT use ramadan_uplift`}),
      "marketIntelligenceNote": string (1 sentence on how ${country} market dynamics, competitive context, or flavor tier affects this SKU)
    }
  ],
  "overallInsight": string (4-5 sentences: strategic summary covering dominant SKUs, seasonal/Ramadan adjustments made, stock health risks addressed, competitive context, and key risks or opportunities for ${country} in ${monthName} ${targetYear}),
  "warnings": string[] (critical alerts: stock-outs, overstocks, data gaps, competitive risks),
  "marketSummary": string (2-3 sentences: Al Fakher's position in ${country} for ${monthName} ${targetYear}, key demand drivers, and outlook)
}`;
        let parsed: any;
        let cameFromLlm = false;
        const hasLlmKey = !!(process.env.BUILT_IN_FORGE_API_KEY && process.env.BUILT_IN_FORGE_API_KEY.trim());

        // Helper: build a single algorithmic recommendation row for a SKU.
        // Used both as the full LLM-failure fallback AND as the per-SKU filler when
        // the LLM omits some active SKUs from its response (coverage validator).
        const buildAlgoRecForSku = (sk: typeof skuSummaries[number], reasoningPrefix: string = '') => {
          const allocPct = skuBaseAllocPct[sk.name] ?? 0;
          const isStockGated = stockGatedSkuIds.has(sk.skuId);
          const mc = isStockGated ? 0 : Math.round(totalMastercases * allocPct / 100);
          const skuObj = skus.find(s => s.id === sk.skuId);
          const health = skuObj ? stockHealthBySku[skuObj.id] : null;
          const conf = skuConfidenceScores[sk.name] ?? 50;

          let trend: string = 'stable';
          const rt = parseFloat(String(sk.rollingTrend));
          if (!isNaN(rt)) { if (rt > 10) trend = 'growing'; else if (rt < -10) trend = 'declining'; }
          if (sk.monthsOfData < 3) trend = 'new';
          if (sk.isNewSkuWithOrders) trend = 'new';

          let stockAlert = 'unknown';
          if (health) {
            const zone = health.targetMonthZone;
            if (zone === 'Critical' || zone === 'Negative' || zone === 'Out of Stock') stockAlert = 'critical';
            else if (zone === 'Overstock') stockAlert = 'overstock';
            else if (zone === 'Healthy') stockAlert = 'healthy';
          }

          let primaryDriver = 'historical_share';
          if (health) {
            const driverZone = health.targetMonthZone ?? health.currentZone;
            if (driverZone === 'Critical' || driverZone === 'Negative' || driverZone === 'Out of Stock') primaryDriver = 'stock_critical';
            else if (driverZone === 'Overstock') primaryDriver = 'stock_overstock';
          }
          if (isRamadanMonth && sk.name.toLowerCase().includes('double apple')) primaryDriver = 'ramadan_uplift';
          if (targetMonth >= 6 && targetMonth <= 8 && primaryDriver === 'historical_share') primaryDriver = 'summer_peak';
          if ((targetMonth === 12 || targetMonth <= 2) && primaryDriver === 'historical_share') primaryDriver = 'winter_dip';
          if (!isNaN(rt) && rt > 10 && primaryDriver === 'historical_share') primaryDriver = 'trend_growth';
          if (!isNaN(rt) && rt < -10 && primaryDriver === 'historical_share') primaryDriver = 'trend_decline';

          const si = parseFloat(String(sk.seasonalityIndex));
          const seasonalityNote = `Seasonality index for ${monthName}: ${isNaN(si) ? 'N/A' : si.toFixed(2)}. ${isRamadanMonth ? `Ramadan effect applies (+${ramadanBoostPct}%).` : currentSeasonalInfo.effect}`;

          return {
            skuId: sk.skuId,
            skuName: sk.rawName,
            weight: sk.rawWeight,
            category: sk.category,
            packagingType: sk.packagingType,
            recommendedMastercases: mc,
            sharePercent: isStockGated ? 0 : Math.round(allocPct * 10) / 10,
            reasoning: isStockGated
              ? `${reasoningPrefix}Excluded from this forecast: ${stockGateWeeksBySku[sk.skuId] >= 99 ? 'stock on hand with no recent sales' : `projected stock coverage is ${stockGateWeeksBySku[sk.skuId]} weeks at the target month`} — still above the 2-week reorder point, so no new volume is placed for this SKU.`
              : `${reasoningPrefix}Based on ${sk.monthsOfData} months of IMS data. Average monthly: ${sk.avgMonthly}. Rolling trend: ${sk.rollingTrend}%. ${health ? `Stock health: ${health.currentWeeks}wks [${health.currentZone}].` : ''}`,
            trend,
            seasonalityNote,
            stockAlert,
            confidenceScore: conf,
            primaryDriver,
            marketIntelligenceNote: `${sk.category} SKU in ${country}. YoY growth: ${sk.yoyGrowth}%.`,
          };
        };

        if (hasLlmKey) {
          try {
            const llmResponse = await invokeLLM({
              messages: [
                { role: 'system', content: 'You are a senior FMCG demand planner and data analyst specializing in the Middle East and North Africa shisha tobacco market. You have deep expertise in Al Fakher products, regional consumption patterns, Ramadan seasonality, and competitive dynamics. Always respond with valid JSON only, no markdown.' },
                { role: 'user', content: prompt },
              ],
              response_format: { type: 'json_object' },
            });
            const rawContent = llmResponse.choices[0].message.content;
            const content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
            try {
              parsed = JSON.parse(content);
              cameFromLlm = true;
            } catch {
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'LLM returned invalid JSON' });
            }
          } catch (llmErr: any) {
            console.warn('[ForecastSplit] LLM call failed, falling back to algorithmic model:', llmErr?.message);
            parsed = null;
          }
        }

        if (!parsed) {
          const algorithmicRecs = skuSummaries.map(sk => buildAlgoRecForSku(sk));

          const allocated = algorithmicRecs.reduce((s, r) => s + r.recommendedMastercases, 0);
          let diff = totalMastercases - allocated;
          if (diff !== 0 && algorithmicRecs.length > 0) {
            algorithmicRecs.sort((a, b) => b.recommendedMastercases - a.recommendedMastercases);
            let i = 0;
            const maxIter = algorithmicRecs.length * Math.abs(diff) + algorithmicRecs.length;
            let iter = 0;
            while (diff !== 0 && iter < maxIter) {
              const idx = i % algorithmicRecs.length;
              // Never pour MC into a stock-gated SKU (2-week reorder-point rule).
              if (diff > 0 && stockGatedSkuIds.has(algorithmicRecs[idx].skuId)) {
                i++;
                iter++;
                continue;
              }
              if (diff > 0) {
                algorithmicRecs[idx].recommendedMastercases += 1;
                diff -= 1;
              } else if (algorithmicRecs[idx].recommendedMastercases > 0) {
                algorithmicRecs[idx].recommendedMastercases -= 1;
                diff += 1;
              }
              i++;
              iter++;
            }
          }

          const finalTotal = algorithmicRecs.reduce((s, r) => s + r.recommendedMastercases, 0);
          algorithmicRecs.forEach(r => {
            r.sharePercent = finalTotal > 0 ? Math.round(r.recommendedMastercases / finalTotal * 1000) / 10 : 0;
          });

          const warnings: string[] = [];
          const critSkus = algorithmicRecs.filter(r => r.stockAlert === 'critical');
          if (critSkus.length > 0) warnings.push(`${critSkus.length} SKU(s) in critical stock zone: ${critSkus.map(r => r.skuName).join(', ')}`);
          const overSkus = algorithmicRecs.filter(r => r.stockAlert === 'overstock');
          if (overSkus.length > 0) warnings.push(`${overSkus.length} SKU(s) overstocked: ${overSkus.map(r => r.skuName).join(', ')}`);

          parsed = {
            recommendations: algorithmicRecs,
            overallInsight: `Algorithmic 5-factor model allocation for ${monthName} ${targetYear} in ${country}. ${totalMastercases} mastercases split across ${skus.length} SKUs using historical trend (35%), seasonality (25%), stock health (20%), market intelligence (10%), and confidence (10%). ${isRamadanMonth ? `Ramadan uplift of +${ramadanBoostPct}% applied to anchor SKUs.` : currentSeasonalInfo.effect} ${critSkus.length > 0 ? `Warning: ${critSkus.length} SKU(s) in critical stock.` : 'All stock levels within acceptable range.'}`,
            warnings,
            marketSummary: `Al Fakher ${country} forecast for ${monthName} ${targetYear}. Market seasonality index: ${marketSeasonalityIndex}. ${countryIntelligence.growthOutlook}`,
          };
        }

        const recommendations = (parsed.recommendations ?? []).map((rec: any) => {
          if (!isRamadanMonth && rec.primaryDriver === 'ramadan_uplift') {
            const skuObj = rec.packagingType
              ? skus.find(sk => sk.name === rec.skuName && sk.weight === rec.weight && (sk as any).packagingType === rec.packagingType)
              : skus.find(sk => sk.name === rec.skuName && sk.weight === rec.weight) ?? skus.find(sk => sk.name === rec.skuName);
            const health = skuObj ? stockHealthBySku[skuObj.id] : null;
            let correctedDriver = 'historical_share';
            if (health) {
              if (health.currentZone === 'Critical' || health.currentZone === 'Negative' || health.currentZone === 'Out of Stock') correctedDriver = 'stock_critical';
              else if (health.currentZone === 'Overstock') correctedDriver = 'stock_overstock';
            }
            if (targetMonth >= 6 && targetMonth <= 8) correctedDriver = 'summer_peak';
            if (targetMonth === 12 || targetMonth <= 2) correctedDriver = 'winter_dip';
            rec.primaryDriver = correctedDriver;
          }
          if (!isRamadanMonth && rec.seasonalityNote) {
            rec.seasonalityNote = rec.seasonalityNote
              .replace(/[Rr]amadan[\s-]*(related|driven|uplift|boost|spike|effect|demand|month|period|season)?/gi, 'seasonal')
              .replace(/\s+/g, ' ').trim();
          }
          return rec;
        });

        let overallInsight = parsed.overallInsight ?? '';
        if (!isRamadanMonth && overallInsight.toLowerCase().includes('ramadan')) {
          overallInsight = overallInsight
            .replace(/[Rr]amadan[\s-]*(related|driven|uplift|boost|spike|effect|demand|adjustment|month|period|season)?/gi, 'seasonal')
            .replace(/\s+/g, ' ').trim();
        }

        // ────────────────────────────────────────────────────────────────────
        // COVERAGE VALIDATOR — guarantees one rec per active SKU.
        // Production logs showed the LLM sometimes returns ~16 recs even when the
        // country has 25+ active SKUs, so any directive ("increase"/"reduce") on a
        // missing SKU was applied to a synthetic 0-MC row, producing odd results.
        //
        // Step 1: resolve every rec back to a known SKU id (echoing rec.skuId when
        //         present, otherwise fuzzy-matching by name+weight+packaging).
        // Step 2: if any active SKU is uncovered AND the response came from the LLM,
        //         do ONE focused retry asking the LLM to fill ONLY the missing SKUs.
        // Step 3: any SKU still missing gets an algorithmic-generator row appended.
        // Step 4: rebalance so the sum still equals totalMastercases.
        // ────────────────────────────────────────────────────────────────────
        {
          const skuById = new Map(skus.map(s => [s.id, s] as const));
          const normLowCov = (s: any) => String(s ?? '').toLowerCase().replace(/\s+/g, '').trim();
          const resolveRecToSkuId = (rec: any): number | null => {
            if (typeof rec.skuId === 'number' && skuById.has(rec.skuId)) return rec.skuId;
            const recName = normLowCov(rec.skuName);
            const recWeight = normLowCov(rec.weight);
            const recPack = normLowCov(rec.packagingType ?? 'New');
            let m = skus.find(s => normLowCov(s.name) === recName && normLowCov(s.weight) === recWeight && normLowCov((s as any).packagingType ?? 'New') === recPack);
            if (!m) m = skus.find(s => normLowCov(s.name) === recName && normLowCov(s.weight) === recWeight);
            if (!m && recName) {
              // The LLM occasionally concatenates name+weight into skuName ("Blueberry 250g")
              const trailing = recName.match(/(\d+\.?\d*)(g|kg)$/i);
              if (trailing) {
                const stripped = recName.replace(/(\d+\.?\d*)(g|kg)$/i, '');
                const weightGuess = `${trailing[1]}${trailing[2]}`.toLowerCase();
                if (stripped) m = skus.find(s => normLowCov(s.name) === stripped && normLowCov(s.weight) === weightGuess);
              }
            }
            if (m) {
              rec.skuId = m.id;
              return m.id;
            }
            return null;
          };

          // Step 1a: canonicalize to AT MOST one row per active SKU id.
          // - Resolve each rec to a SKU id (using rec.skuId then fuzzy match).
          // - For unresolved rows: DROP (LLM hallucinated a SKU not in our catalog).
          // - For duplicate rows mapped to the same SKU id: keep the one with the
          //   highest recommendedMastercases (most informative), drop the others.
          // This guarantees the output schema "one row per active SKU".
          const canonical = new Map<number, any>();
          let droppedUnmatched = 0;
          let droppedDuplicates = 0;
          for (const rec of recommendations) {
            const id = resolveRecToSkuId(rec);
            if (id === null) { droppedUnmatched++; continue; }
            const existing = canonical.get(id);
            if (!existing) {
              canonical.set(id, rec);
            } else {
              const exMc = Math.max(0, Math.round(existing.recommendedMastercases ?? 0));
              const newMc = Math.max(0, Math.round(rec.recommendedMastercases ?? 0));
              if (newMc > exMc) canonical.set(id, rec);
              droppedDuplicates++;
            }
          }
          // Mutate the recommendations array in place to hold the canonical set.
          recommendations.length = 0;
          canonical.forEach(rec => recommendations.push(rec));
          const coveredIds = new Set<number>(canonical.keys());

          let missingIds = skus.filter(s => !coveredIds.has(s.id)).map(s => s.id);
          console.log(`[ForecastSplit] Coverage check: ${skus.length} SKUs in DB, ${recommendations.length} recs returned (${droppedDuplicates} duplicates merged, ${droppedUnmatched} unmatched dropped), ${coveredIds.size} resolved, ${missingIds.length} missing.`);

          // Step 2: focused retry to the LLM for the missing SKUs only.
          if (missingIds.length > 0 && cameFromLlm && hasLlmKey) {
            const missingSkuObjs = missingIds.map(id => skus.find(s => s.id === id)!).filter(Boolean);
            const missingLines = missingSkuObjs.map(s => {
              const summary = skuSummaries.find(x => x.skuId === s.id);
              const baseAllocPct = summary ? (skuBaseAllocPct[summary.name] ?? 0) : 0;
              const baseMc = Math.round(totalMastercases * baseAllocPct / 100);
              return `  ${s.id} | ${s.name} ${s.weight} (${(s as any).packagingType ?? 'New'}) — base alloc ${baseAllocPct.toFixed(1)}% (~${baseMc} MC)`;
            }).join('\n');
            const retryPrompt = `Your previous forecast-split response for ${monthName} ${targetYear} in ${country} was missing recommendations for ${missingSkuObjs.length} active SKU(s). Return JSON ONLY in this shape:
{
  "recommendations": [
    {
      "skuId": number,
      "skuName": string,
      "weight": string,
      "category": string,
      "packagingType": "Old"|"New",
      "recommendedMastercases": number,
      "sharePercent": number,
      "reasoning": string,
      "trend": "growing"|"stable"|"declining"|"new",
      "seasonalityNote": string,
      "stockAlert": "critical"|"healthy"|"overstock"|"unknown",
      "confidenceScore": number,
      "primaryDriver": string,
      "marketIntelligenceNote": string
    }
  ]
}

Cover EXACTLY these ${missingSkuObjs.length} SKU(s) — one row per id, no duplicates, no other SKUs:
${missingLines}

Use the base allocation hints above as a starting point; you may adjust ±25% based on stock health, seasonality, and trend if you wish. Do NOT re-emit any other SKU. Do NOT exceed reasonable totals — these will be rebalanced into the master split.`;
            try {
              const retryResp = await invokeLLM({
                messages: [
                  { role: 'system', content: 'You are a senior FMCG demand planner. Respond with valid JSON only, no markdown.' },
                  { role: 'user', content: retryPrompt },
                ],
                response_format: { type: 'json_object' },
              });
              const rawRetry = retryResp.choices[0].message.content;
              const txtRetry = typeof rawRetry === 'string' ? rawRetry : JSON.stringify(rawRetry);
              const retryParsed = JSON.parse(txtRetry);
              const retryRecs: any[] = Array.isArray(retryParsed?.recommendations) ? retryParsed.recommendations : [];
              let added = 0;
              for (const rec of retryRecs) {
                const id = resolveRecToSkuId(rec);
                // Only accept recs that map to a still-missing active SKU id.
                if (id !== null && missingIds.includes(id) && !coveredIds.has(id)) {
                  recommendations.push(rec);
                  coveredIds.add(id);
                  added++;
                }
              }
              missingIds = skus.filter(s => !coveredIds.has(s.id)).map(s => s.id);
              console.log(`[ForecastSplit] Coverage retry added ${added} rec(s) from LLM; ${missingIds.length} still missing.`);
            } catch (retryErr: any) {
              console.warn('[ForecastSplit] Coverage retry LLM call failed:', retryErr?.message);
            }
          }

          // Step 3: algorithmic fill for any SKU the LLM still failed to return.
          if (missingIds.length > 0) {
            const filled = missingIds.length;
            for (const id of missingIds) {
              const sk = skuSummaries.find(s => s.skuId === id);
              if (!sk) continue;
              recommendations.push(buildAlgoRecForSku(sk, 'Algorithmic fallback (LLM omitted this SKU). '));
              coveredIds.add(id);
            }
            missingIds = skus.filter(s => !coveredIds.has(s.id)).map(s => s.id);
            console.log(`[ForecastSplit] Coverage filled ${filled} SKU(s) via algorithmic fallback.`);
          }

          // Step 3b: hard schema gate — at this point, every active SKU MUST appear
          // exactly once. If anything is still off, log loudly so it's visible.
          if (recommendations.length !== skus.length || coveredIds.size !== skus.length || missingIds.length !== 0) {
            console.error(`[ForecastSplit] Coverage GATE failed: ${skus.length} SKUs in DB, ${recommendations.length} recs, ${coveredIds.size} unique covered, ${missingIds.length} missing. Dropping any orphan rows.`);
            // Last-resort dedup: keep at most one row per active SKU id, drop everything else.
            const finalCanonical = new Map<number, any>();
            for (const rec of recommendations) {
              const id = typeof rec.skuId === 'number' && skus.some(s => s.id === rec.skuId) ? rec.skuId : null;
              if (id !== null && !finalCanonical.has(id)) finalCanonical.set(id, rec);
            }
            // Fill any still-missing SKUs with algorithmic rows.
            for (const s of skus) {
              if (!finalCanonical.has(s.id)) {
                const sk = skuSummaries.find(x => x.skuId === s.id);
                if (sk) finalCanonical.set(s.id, buildAlgoRecForSku(sk, 'Algorithmic fallback (coverage gate). '));
              }
            }
            recommendations.length = 0;
            finalCanonical.forEach(rec => recommendations.push(rec));
          }

          // Step 3c: HARD STOCK GATE enforcement — regardless of what the LLM
          // returned, any SKU whose projected coverage at the target month is
          // still above the 2-week reorder point is forced to 0 MC. The freed volume is redistributed to
          // non-gated SKUs by the Step 4 rebalance below (which skips gated
          // rows as receivers).
          for (const rec of recommendations) {
            const id = typeof rec.skuId === 'number' ? rec.skuId : null;
            if (id === null || !stockGatedSkuIds.has(id)) continue;
            const before = Math.max(0, Math.round(rec.recommendedMastercases ?? 0));
            rec.recommendedMastercases = 0;
            rec.sharePercent = 0;
            rec.stockAlert = 'overstock';
            rec.primaryDriver = 'stock_overstock';
            const wk = stockGateWeeksBySku[id];
            const wkText = wk >= 99 ? 'stock on hand with no recent sales' : `projected stock coverage of ${wk} weeks at the target month`;
            rec.reasoning = `Excluded from this forecast: ${wkText} — still above the 2-week reorder point, so no new volume is placed for this SKU.${before > 0 ? ` (${before} MC redistributed to other SKUs.)` : ''}`;
          }

          // Step 4: rebalance so the sum still equals totalMastercases EXACTLY.
          // Newly-added rows usually push the total above totalMastercases.
          const sumNow = recommendations.reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
          let diffCov = totalMastercases - sumNow;
          if (diffCov !== 0 && recommendations.length > 0) {
            // Gated rows can never receive MC; when removing MC they are already 0.
            const sortable: { idx: number; mc: number }[] = recommendations
              .map((r: any, idx: number) => ({ idx, mc: Math.max(0, Math.round(r.recommendedMastercases ?? 0)) }))
              .filter((d: { idx: number; mc: number }) => !(typeof recommendations[d.idx].skuId === 'number' && stockGatedSkuIds.has(recommendations[d.idx].skuId)))
              .sort((a: { idx: number; mc: number }, b: { idx: number; mc: number }) => b.mc - a.mc);
            let i = 0;
            const maxIter = sortable.length * Math.abs(diffCov) + sortable.length + 1;
            let iter = 0;
            // Pass 1: prefer trimming rows with mc > 1 to keep small allocations alive.
            while (diffCov !== 0 && iter < maxIter && sortable.length > 0) {
              const t = sortable[i % sortable.length];
              const cur = Math.max(0, Math.round(recommendations[t.idx].recommendedMastercases ?? 0));
              if (diffCov > 0) {
                recommendations[t.idx].recommendedMastercases = cur + 1;
                diffCov -= 1;
              } else if (cur > 1) {
                recommendations[t.idx].recommendedMastercases = cur - 1;
                diffCov += 1;
              }
              i++;
              iter++;
            }
            // Pass 2 (hard fallback): if we still need to remove MC, allow taking
            // from rows with cur > 0 (will zero them). Required to guarantee the
            // total exactly matches totalMastercases.
            if (diffCov < 0) {
              const sortable2: { idx: number; mc: number }[] = recommendations
                .map((r: any, idx: number) => ({ idx, mc: Math.max(0, Math.round(r.recommendedMastercases ?? 0)) }))
                .filter((d: { idx: number; mc: number }) => d.mc > 0)
                .sort((a: { idx: number; mc: number }, b: { idx: number; mc: number }) => b.mc - a.mc);
              let j = 0;
              let it2 = 0;
              const maxIt2 = sortable2.length * Math.abs(diffCov) + sortable2.length + 1;
              while (diffCov < 0 && it2 < maxIt2 && sortable2.length > 0) {
                const t = sortable2[j % sortable2.length];
                const cur = Math.max(0, Math.round(recommendations[t.idx].recommendedMastercases ?? 0));
                if (cur > 0) {
                  recommendations[t.idx].recommendedMastercases = cur - 1;
                  diffCov += 1;
                }
                j++;
                it2++;
              }
              if (diffCov !== 0) {
                console.error(`[ForecastSplit] Coverage rebalance could not reach totalMastercases (residual ${diffCov} MC). Total may be off — investigate.`);
              }
            }
            // If MC still needs to be ADDED but every eligible receiver is
            // stock-gated (all-gated country), surface it instead of silently
            // returning a lower total.
            if (diffCov > 0) {
              (parsed.warnings ??= []).push(`Could not place ${diffCov} MC because every remaining SKU still has projected stock coverage above the 2-week reorder point. The recommended total is ${totalMastercases - diffCov} MC instead of ${totalMastercases} MC.`);
              console.warn(`[ForecastSplit] Stock gate left ${diffCov} MC unplaced (all eligible SKUs gated).`);
            }
            const finalT = recommendations.reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
            recommendations.forEach((r: any) => {
              r.sharePercent = finalT > 0 ? Math.round((r.recommendedMastercases / finalT) * 1000) / 10 : 0;
            });
          }

          // Recompute unique-coverage from the current recommendations array so the
          // metric reflects any post-gate rewrite, not the pre-gate coveredIds set.
          const finalCoveredIds = new Set<number>();
          for (const rec of recommendations) {
            const id = typeof rec.skuId === 'number' ? rec.skuId : null;
            if (id !== null && skus.some(s => s.id === id)) finalCoveredIds.add(id);
          }
          console.log(`[ForecastSplit] Final coverage: ${skus.length} SKUs in DB, ${recommendations.length} recs returned (${finalCoveredIds.size} unique SKUs covered).`);
        }

        // Deterministic post-processing: enforce non-zero allocation for any flagged
        // "NEW SKU WITH ACTIVE ORDERS" — applies whether output came from the LLM or fallback.
        // For each flagged SKU, compute a target allocation = its share of total committed orders,
        // applied to total mastercases, with a hard minimum of 1 MC. Donor MC is taken proportionally
        // from non-flagged SKUs that have allocation above 1.
        const newSkuLookup = new Map<string, typeof skuSummaries[number]>();
        for (const sk of skuSummaries) {
          if (sk.isNewSkuWithOrders) {
            const k1 = `${sk.rawName}|${sk.rawWeight}|${sk.packagingType}`;
            const k2 = `${sk.rawName}|${sk.rawWeight}`;
            newSkuLookup.set(k1, sk);
            newSkuLookup.set(k2, sk);
          }
        }
        if (newSkuLookup.size > 0 && recommendations.length > 0) {
          const allOrdersTotal = skuSummaries.reduce((s, x) => s + x.recentOrdersMC + x.upcomingOrdersMC, 0);
          const targets = new Map<number, number>(); // index → target MC
          recommendations.forEach((rec: any, idx: number) => {
            const k1 = `${rec.skuName}|${rec.weight}|${rec.packagingType}`;
            const k2 = `${rec.skuName}|${rec.weight}`;
            const sk = newSkuLookup.get(k1) ?? newSkuLookup.get(k2);
            if (!sk) return;
            // HARD STOCK GATE wins over the new-SKU safeguard: a new SKU whose
            // projected coverage is still above the 2-week reorder point must stay at 0 MC.
            if (stockGatedSkuIds.has(sk.skuId)) return;
            const skuOrders = sk.recentOrdersMC + sk.upcomingOrdersMC;
            const orderShare = allOrdersTotal > 0 ? (skuOrders / allOrdersTotal) : 0;
            const proposed = Math.max(1, Math.round(totalMastercases * orderShare));
            const current = Math.max(0, Math.round(rec.recommendedMastercases ?? 0));
            if (proposed > current) targets.set(idx, proposed - current);
          });
          const needed = Array.from(targets.values()).reduce((s, v) => s + v, 0);
          if (needed > 0) {
            // Donors: non-flagged SKUs with current allocation > 1, sorted by allocation desc
            const donors = recommendations
              .map((rec: any, idx: number) => ({ idx, mc: Math.max(0, Math.round(rec.recommendedMastercases ?? 0)), isFlagged: targets.has(idx) }))
              .filter((d: { idx: number; mc: number; isFlagged: boolean }) => !d.isFlagged && d.mc > 1)
              .sort((a: { mc: number }, b: { mc: number }) => b.mc - a.mc);
            // Apply boosts to flagged SKUs first
            for (const [idx, boost] of targets.entries()) {
              recommendations[idx].recommendedMastercases = Math.round((recommendations[idx].recommendedMastercases ?? 0)) + boost;
              if (!recommendations[idx].reasoning || !/order/i.test(recommendations[idx].reasoning)) {
                recommendations[idx].reasoning = (recommendations[idx].reasoning ?? '') + ` Allocation boosted to honor planner-committed orders for this new SKU.`;
              }
              if (recommendations[idx].trend === 'declining' || recommendations[idx].trend === 'stable') {
                recommendations[idx].trend = 'new';
              }
            }
            // Take from donors round-robin until we've taken `needed` MC
            let take = needed;
            let i = 0;
            const maxIter = donors.length * needed + donors.length + 1;
            let iter = 0;
            while (take > 0 && donors.length > 0 && iter < maxIter) {
              const d = donors[i % donors.length];
              const cur = Math.round(recommendations[d.idx].recommendedMastercases ?? 0);
              if (cur > 1) {
                recommendations[d.idx].recommendedMastercases = cur - 1;
                take -= 1;
              }
              i++;
              iter++;
            }
            // Recompute share percentages
            const finalTotal = recommendations.reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
            recommendations.forEach((r: any) => {
              r.sharePercent = finalTotal > 0 ? Math.round((r.recommendedMastercases / finalTotal) * 1000) / 10 : 0;
            });
          }
        }

        // Deterministic enforcement of parsed planner directives.
        // Runs AFTER both LLM and algorithmic outputs, so the planner's intent is honored
        // regardless of whether the main LLM obeyed the prompt instructions.
        const extraWarnings: string[] = [];
        if (stockGatedSkuIds.size > 0) {
          const gatedNames = skus
            .filter(s => stockGatedSkuIds.has(s.id))
            .map(s => `${s.name} ${s.weight} (${(s as any).packagingType ?? 'New'})`);
          extraWarnings.push(`${gatedNames.length} SKU(s) excluded from this forecast — projected stock coverage still above the 2-week reorder point at the target month: ${gatedNames.join(', ')}. Their volume was redistributed to other SKUs.`);
        }
        if (parsedDirectives.length > 0 && recommendations.length > 0) {
          // Helper: find recommendation index by SKU id.
          // Primary key is rec.skuId (LLM is told to echo it). Fallback uses
          // normalized name+weight+packaging — but NEVER name-only, because
          // multiple SKUs can share a base name and that would silently overwrite.
          const normLow = (s: any) => String(s ?? '').toLowerCase().replace(/\s+/g, '').trim();
          const validSkuIdSet = new Set(skus.map(s => s.id));
          const recIndexBySkuId = new Map<number, number>();
          let matchedById = 0, matchedByFallback = 0, unmatched = 0;
          recommendations.forEach((rec: any, idx: number) => {
            // 0) Trust rec.skuId when present and valid
            if (typeof rec.skuId === 'number' && validSkuIdSet.has(rec.skuId)) {
              if (!recIndexBySkuId.has(rec.skuId)) {
                recIndexBySkuId.set(rec.skuId, idx);
                matchedById++;
              }
              return;
            }
            const recName = normLow(rec.skuName);
            const recWeight = normLow(rec.weight);
            const recPack = normLow(rec.packagingType ?? 'New');
            // 1) Exact name+weight+packaging
            let matched = skus.find(s =>
              normLow(s.name) === recName &&
              normLow(s.weight) === recWeight &&
              normLow((s as any).packagingType ?? 'New') === recPack);
            // 2) Name+weight (any packaging)
            if (!matched) matched = skus.find(s => normLow(s.name) === recName && normLow(s.weight) === recWeight);
            // 2b) The LLM sometimes concatenates name+weight into skuName like "Blueberry 250g"
            //     and leaves weight blank or duplicates it. Strip a trailing weight token.
            if (!matched && !recWeight) {
              const stripped = recName.replace(/(\d+\.?\d*)(g|kg)$/i, '');
              const trailing = recName.match(/(\d+\.?\d*)(g|kg)$/i);
              if (stripped && trailing) {
                const weightGuess = `${trailing[1]}${trailing[2]}`.toLowerCase();
                matched = skus.find(s => normLow(s.name) === stripped && normLow(s.weight) === weightGuess);
              }
            }
            // 2c) name === "X Yg" matches sku.name="X" sku.weight="Yg"
            if (!matched) {
              for (const s of skus) {
                const combo = normLow(`${s.name}${s.weight}`);
                if (combo === recName) { matched = s; break; }
              }
            }
            if (matched && !recIndexBySkuId.has(matched.id)) {
              recIndexBySkuId.set(matched.id, idx);
              matchedByFallback++;
              rec.skuId = matched.id;
            } else if (!matched) {
              unmatched++;
            }
          });
          console.log(`[ForecastSplit] Recs→SKU mapping: ${matchedById} by id, ${matchedByFallback} by name fallback, ${unmatched} unmatched (of ${recommendations.length} recs).`);
          if (unmatched > 0) {
            const samples = recommendations
              .filter((r: any) => !r.skuId)
              .slice(0, 5)
              .map((r: any) => `"${r.skuName}"|"${r.weight}"|"${r.packagingType}"`)
              .join(' ; ');
            console.log(`[ForecastSplit] Unmatched rec samples: ${samples}`);
          }

          // For any directive SKU NOT in the recommendations array, append a synthetic
          // recommendation row with 0 MC so the directive can be applied (e.g. "set
          // Blueberry 250g to zero" still shows the SKU on screen at 0). Only does
          // this when the action is non-zero or when the planner explicitly asked
          // to set it to zero — without this, an absent SKU could not be enforced.
          for (const dir of parsedDirectives) {
            for (const skuId of dir.skuIds) {
              if (recIndexBySkuId.has(skuId)) continue;
              const sku = skus.find(s => s.id === skuId);
              if (!sku) continue;
              const synthetic: any = {
                skuName: sku.name,
                weight: sku.weight,
                category: sku.category ?? 'Core',
                packagingType: (sku as any).packagingType ?? 'New',
                recommendedMastercases: 0,
                sharePercent: 0,
                reasoning: '',
                trend: 'stable',
                seasonalityNote: '',
                stockAlert: 'unknown',
                confidenceScore: 50,
                primaryDriver: 'market_intel',
                marketIntelligenceNote: '',
              };
              recommendations.push(synthetic);
              recIndexBySkuId.set(skuId, recommendations.length - 1);
            }
          }

          // Track which SKU ids are "locked" by a planner directive — they should not be donors/receivers
          // for redistribution caused by other directives.
          const lockedSkuIds = new Set<number>();
          // Subset of locked SKUs that the planner explicitly zeroed/capped to 0.
          // The hard-fallback rebalance must NEVER add MC back to these — that
          // would silently reverse the planner's intent.
          const zeroedSkuIds = new Set<number>();
          // Stock-gated SKUs (projected coverage above the 2-week reorder point) start locked at 0 so directive
          // rebalancing can never pour MC back into them. An explicit planner
          // directive on such a SKU still applies below (planner intent wins
          // over the automatic gate) — applyDirectiveToRec overwrites the value
          // and manages the zero-protection itself.
          const directiveTargetIds = new Set<number>(parsedDirectives.flatMap(d => d.skuIds));
          for (const gatedId of stockGatedSkuIds) {
            if (directiveTargetIds.has(gatedId)) continue;
            lockedSkuIds.add(gatedId);
            zeroedSkuIds.add(gatedId);
          }
          const directiveAppliedSummaries: string[] = [];

          // Helper: apply a directive's math to a single rec.
          // CRITICAL: locks the SKU id BEFORE the no-op early return. Otherwise
          // an explicit "zero" directive on a SKU whose row already shows 0 MC
          // (most often a synthetic row added because the LLM omitted that SKU)
          // produces delta=0, the row stays unlocked, and the rebalance pass
          // happily pours mastercases BACK into it to make the total match —
          // user sees a non-zero value on a SKU they explicitly zeroed.
          const applyDirectiveToRec = (rec: any, dir: any, skuId: number, skuLabel: string) => {
            const before = Math.max(0, Math.round(rec.recommendedMastercases ?? 0));
            let after = before;
            if (dir.action === 'zero') after = 0;
            else if (dir.action === 'reduce') {
              const pct = Math.min(100, Math.max(0, dir.valuePct ?? 20));
              after = Math.max(0, Math.round(before * (1 - pct / 100)));
            } else if (dir.action === 'increase') {
              const pct = Math.max(0, dir.valuePct ?? 25);
              after = Math.max(before + 1, Math.round(before * (1 + pct / 100)));
            } else if (dir.action === 'cap') {
              const cap = Math.max(0, Math.round(dir.valueMC ?? 0));
              after = Math.min(before, cap);
            } else if (dir.action === 'set') {
              // Force the SKU to an exact MC value. Unlike "cap" (a ceiling that can
              // only lower a value), "set" can raise a SKU up from 0 — needed for new
              // SKUs the recommender starts at 0 but the planner wants to stock.
              after = Math.max(0, Math.round(dir.valueMC ?? 0));
            } else if (dir.action === 'prioritize') {
              after = Math.max(before + 1, Math.round(before * 1.20));
            }
            // ALWAYS lock — the planner explicitly chose this SKU, so its value
            // (even if unchanged) must not be touched by the rebalance pass.
            lockedSkuIds.add(skuId);
            // Any directive (zero, cap-to-0, reduce-100%) that drives the rec to
            // 0 must protect that 0 from being re-filled by the rebalance.
            if (after === 0 && (dir.action === 'zero' || dir.action === 'cap' || dir.action === 'reduce' || dir.action === 'set')) {
              zeroedSkuIds.add(skuId);
            }
            if (after === before) return false;
            rec.recommendedMastercases = after;
            rec.reasoning = `${rec.reasoning ?? ''} [Planner directive: ${dir.action}${dir.valuePct ? ` ${dir.valuePct}%` : ''}${dir.valueMC !== undefined ? ` ${dir.valueMC}MC` : ''} → ${before} → ${after} MC]`.trim();
            rec.primaryDriver = 'market_intel';
            if (after === 0) rec.trend = 'declining';
            directiveAppliedSummaries.push(`${skuLabel}: ${dir.action} (${before}→${after} MC)`);
            // Health-conflict warning
            const healthInfo = stockHealthBySku[skuId];
            if (healthInfo && (after < before) && (healthInfo.targetMonthZone === 'Critical' || healthInfo.targetMonthZone === 'Negative' || healthInfo.targetMonthZone === 'Out of Stock')) {
              extraWarnings.push(`Planner reduced "${skuLabel}" but stock is ${healthInfo.targetMonthZone} for ${monthName} ${targetYear}.`);
            }
            return true;
          };

          // PASS 1: Apply each directive to its mapped rec (by SKU id index).
          for (const dir of parsedDirectives) {
            for (const skuId of dir.skuIds) {
              const idx = recIndexBySkuId.get(skuId);
              if (idx === undefined) continue;
              const sku = skus.find(s => s.id === skuId);
              const skuLabel = sku ? `${sku.name} ${sku.weight} (${(sku as any).packagingType ?? 'New'})` : recommendations[idx].skuName;
              applyDirectiveToRec(recommendations[idx], dir, skuId, skuLabel);
            }
          }

          // PASS 2 — fuzzy sweep: for each directive's SKU, find any OTHER recs in
          // the array that look like the same SKU (same normalized name+weight)
          // and apply the directive to them too. This catches the case where the
          // LLM emitted a duplicate or near-duplicate row that wasn't the one we
          // mapped — e.g. user clicked "Blueberry 250g → zero" but the LLM's
          // "Blueberry 250g" rec was mapped to a different SKU id by name-only
          // collision. The user's intent is clearly: zero anything that LOOKS
          // like Blueberry 250g. Without this sweep, the visible row still shows
          // a non-zero value.
          const recsAlreadyApplied = new Set<number>();
          recIndexBySkuId.forEach((idx, sid) => {
            if (lockedSkuIds.has(sid)) recsAlreadyApplied.add(idx);
          });
          for (const dir of parsedDirectives) {
            for (const skuId of dir.skuIds) {
              const sku = skus.find(s => s.id === skuId);
              if (!sku) continue;
              const targetName = normLow(sku.name);
              const targetWeight = normLow(sku.weight);
              const targetPack = normLow((sku as any).packagingType ?? 'New');
              const skuLabel = `${sku.name} ${sku.weight} (${(sku as any).packagingType ?? 'New'})`;
              recommendations.forEach((rec: any, idx: number) => {
                if (recsAlreadyApplied.has(idx)) return;
                const recName = normLow(rec.skuName);
                const recWeight = normLow(rec.weight);
                const recPack = normLow(rec.packagingType ?? 'New');
                const nameMatches =
                  recName === targetName ||
                  recName === normLow(`${sku.name}${sku.weight}`) ||
                  (recName.startsWith(targetName) && recName.endsWith(targetWeight));
                const weightMatches = !recWeight || recWeight === targetWeight;
                // Packaging must match for Old/New variants — otherwise we'd
                // incorrectly zero the Old variant when the user meant New.
                const packMatches = recPack === targetPack;
                if (nameMatches && weightMatches && packMatches) {
                  if (applyDirectiveToRec(rec, dir, skuId, skuLabel)) {
                    recsAlreadyApplied.add(idx);
                  }
                }
              });
            }
          }

          // Rebalance: ensure total still equals totalMastercases.
          // Donors / receivers are non-locked SKUs only.
          // CRITICAL: lock detection MUST use the SAME normalized index that the
          // enforcement pass used. If we re-resolve with strict equality here, the
          // LLM's slight name/weight casing differences (e.g. "1kg" vs "1Kg") cause
          // the lock check to fail silently — and the rebalance then reverts the
          // directive by treating the locked row as a flexible donor/receiver.
          // We invert the rec→skuId map and reuse it.
          const skuIdByRecIdx = new Map<number, number>();
          recIndexBySkuId.forEach((idx, skuId) => { skuIdByRecIdx.set(idx, skuId); });
          const sumNow = recommendations.reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
          let diff = totalMastercases - sumNow;
          if (diff !== 0) {
            const flexibleIdxs = recommendations
              .map((rec: any, idx: number) => {
                const id = skuIdByRecIdx.get(idx);
                return { idx, mc: Math.max(0, Math.round(rec.recommendedMastercases ?? 0)), locked: id !== undefined && lockedSkuIds.has(id) };
              })
              .filter((d: { idx: number; mc: number; locked: boolean }) => !d.locked);

            // Sort donors (mc desc) and receivers (mc desc) for stability
            flexibleIdxs.sort((a: { mc: number }, b: { mc: number }) => b.mc - a.mc);

            const maxIter = flexibleIdxs.length * Math.abs(diff) + flexibleIdxs.length + 1;
            let i = 0;
            let iter = 0;
            while (diff !== 0 && flexibleIdxs.length > 0 && iter < maxIter) {
              const target = flexibleIdxs[i % flexibleIdxs.length];
              const cur = Math.max(0, Math.round(recommendations[target.idx].recommendedMastercases ?? 0));
              if (diff > 0) {
                recommendations[target.idx].recommendedMastercases = cur + 1;
                diff -= 1;
              } else if (cur > 0) {
                recommendations[target.idx].recommendedMastercases = cur - 1;
                diff += 1;
              }
              i++;
              iter++;
            }

            // Hard-fallback: if every SKU is locked (or all flexible rows are 0 and we still
            // need to remove MC), fall back to taking from the largest locked SKU we INCREASED
            // (or, as a last resort, any row with mc > 0). This guarantees the total is preserved.
            // CRITICAL: SKUs the planner explicitly zeroed (or capped to 0) are NEVER eligible
            // to receive MC back — that would silently reverse the planner's intent.
            if (diff !== 0) {
              extraWarnings.push(`Planner directives could not be balanced fully via flexible SKUs (residual ${diff} MC). Adjusting locked rows as last resort.`);
              const allIdxs = recommendations
                .map((rec: any, idx: number) => ({
                  idx,
                  mc: Math.max(0, Math.round(rec.recommendedMastercases ?? 0)),
                  zeroed: (() => { const id = skuIdByRecIdx.get(idx); return id !== undefined && zeroedSkuIds.has(id); })(),
                }))
                .filter((d: { idx: number; mc: number; zeroed: boolean }) => !d.zeroed); // never touch explicitly-zeroed rows
              allIdxs.sort((a: { mc: number }, b: { mc: number }) => b.mc - a.mc);
              let j = 0;
              let it2 = 0;
              const maxIt2 = allIdxs.length * Math.abs(diff) + allIdxs.length + 1;
              while (diff !== 0 && allIdxs.length > 0 && it2 < maxIt2) {
                const t = allIdxs[j % allIdxs.length];
                const cur = Math.max(0, Math.round(recommendations[t.idx].recommendedMastercases ?? 0));
                if (diff > 0) {
                  recommendations[t.idx].recommendedMastercases = cur + 1;
                  diff -= 1;
                } else if (cur > 0) {
                  recommendations[t.idx].recommendedMastercases = cur - 1;
                  diff += 1;
                }
                j++;
                it2++;
              }
              if (diff !== 0) {
                extraWarnings.push(`Could not perfectly balance ${Math.abs(diff)} MC because too many SKUs are zeroed/locked. Total may differ slightly from requested ${totalMastercases}.`);
              }
            }
          }

          // Recompute share percentages
          const finalTotal = recommendations.reduce((s: number, r: any) => s + Math.max(0, Math.round(r.recommendedMastercases ?? 0)), 0);
          recommendations.forEach((r: any) => {
            r.sharePercent = finalTotal > 0 ? Math.round((r.recommendedMastercases / finalTotal) * 1000) / 10 : 0;
          });

          if (directiveAppliedSummaries.length > 0) {
            overallInsight = `${overallInsight} Planner directives applied: ${directiveAppliedSummaries.join('; ')}.`.trim();
          }
        }

        const finalWarnings = [...(parsed.warnings ?? []), ...extraWarnings];

        return {
          totalTons,
          totalMastercases,
          mastercaseKg,
          targetMonth,
          targetYear,
          country,
          recommendations,
          overallInsight,
          warnings: finalWarnings,
          marketSummary: parsed.marketSummary ?? '',
          isRamadanMonth,
          ramadanBoostPct,
          marketSeasonalityIndex: parseFloat(marketSeasonalityIndex),
        };
      }),
    applyToForecast: protectedProcedure
      .input(z.object({
        country: z.string(),
        targetMonth: z.number().int().min(1).max(12),
        targetYear: z.number().int().min(2020).max(2035),
        mastercaseKg: z.number().positive(),
        recommendations: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          packagingType: z.string().optional(),
          recommendedMastercases: z.number().int().min(0),
        })),
              }))
      .mutation(async ({ input, ctx }) => {
        const country = input.country as 'Lebanon' | 'Syria' | 'Libya';
        const allSkus = await db.getSkusForCountry(country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const period = allPeriods.find(p => p.year === input.targetYear && p.month === input.targetMonth);
        if (!period) throw new TRPCError({ code: 'NOT_FOUND', message: `No period found for ${input.targetYear}-${input.targetMonth} in ${country}` });
        // Snapshot previous values before overwriting
        const snapshot: { skuName: string; weight: string; packagingType?: string; previousValue: string; previousImsValue: string }[] = [];
        let applied = 0;
        for (const rec of input.recommendations) {
          let sku = rec.packagingType
            ? allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight && (s as any).packagingType === rec.packagingType)
            : null;
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName && s.weight === rec.weight);
          if (!sku) sku = allSkus.find(s => s.name === rec.skuName);
          if (!sku) continue;
          const currentRows = await db.getForecastValueForPeriod(sku.id, period.id);
          const currentIms = await db.getImsValueForPeriod(sku.id, period.id);
          snapshot.push({ skuName: rec.skuName, weight: rec.weight, packagingType: rec.packagingType, previousValue: currentRows ?? '0', previousImsValue: currentIms ?? '0' });
          const value = rec.recommendedMastercases.toString();
          // Write to Forecast
          await db.upsertForecastData(sku.id, period.id, value);
          // Also write to IMS (so IMS vs Forecast page reflects the same values)
          await db.upsertImsData(sku.id, period.id, value, false);
          applied++;
        }
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][input.targetMonth - 1];
        await db.logAudit({
          username: getAuditActor(ctx),
          action: 'edit',
          sheet: 'Forecast',
          details: `Applied AI recommended forecast split to ${monthName} ${input.targetYear} for ${country} — ${applied} SKUs updated (Forecast + IMS)`,
        });
        return { success: true, applied, snapshot };
      }),
    undoApply: protectedProcedure
      .input(z.object({
        country: z.string(),
        targetMonth: z.number().int().min(1).max(12),
        targetYear: z.number().int().min(2020).max(2035),
        snapshot: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          packagingType: z.string().optional(),
          previousValue: z.string(),
          previousImsValue: z.string().optional(),
        })),
              }))
      .mutation(async ({ input, ctx }) => {
        const country = input.country as 'Lebanon' | 'Syria' | 'Libya';
        const allSkus = await db.getSkusForCountry(country);
        const allPeriods = await db.getPeriodsForCountry(country);
        const period = allPeriods.find(p => p.year === input.targetYear && p.month === input.targetMonth);
        if (!period) throw new TRPCError({ code: 'NOT_FOUND', message: `No period found for ${input.targetYear}-${input.targetMonth} in ${country}` });
        let restored = 0;
        for (const snap of input.snapshot) {
          let sku = snap.packagingType
            ? allSkus.find(s => s.name === snap.skuName && s.weight === snap.weight && (s as any).packagingType === snap.packagingType)
            : null;
          if (!sku) sku = allSkus.find(s => s.name === snap.skuName && s.weight === snap.weight);
          if (!sku) sku = allSkus.find(s => s.name === snap.skuName);
          if (!sku) continue;
          // Restore Forecast
          await db.upsertForecastData(sku.id, period.id, snap.previousValue);
          // Restore IMS to previous value
          if (snap.previousImsValue !== undefined) {
            await db.upsertImsData(sku.id, period.id, snap.previousImsValue, false);
          }
          restored++;
        }
        const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][input.targetMonth - 1];
        await db.logAudit({
          username: getAuditActor(ctx),
          action: 'edit',
          sheet: 'Forecast',
          details: `Undid AI recommended forecast split for ${monthName} ${input.targetYear} in ${country} — ${restored} SKUs restored (Forecast + IMS)`,
        });
        return { success: true, restored };
      }),
    bulkApplyToForecast: protectedProcedure
      .input(z.object({
        country: z.string(),
        months: z.array(z.object({ month: z.number().min(1).max(12), year: z.number() })).min(1).max(12),
        recommendations: z.array(z.object({
          skuName: z.string(),
          weight: z.string(),
          packagingType: z.string().optional(),
          recommendedMastercases: z.number(),
          sharePercent: z.number(),
        })),
      }))
      .mutation(async ({ ctx, input }) => {
        const typedCountry = input.country as 'Lebanon' | 'Syria' | 'Libya';
        const { months, recommendations } = input;
        const skus = await db.getSkusForCountry(typedCountry);
        const allPeriods = await db.getPeriodsForCountry(typedCountry);
        let totalApplied = 0;
        const monthResults: Array<{ month: number; year: number; applied: number }> = [];
        for (const { month, year } of months) {
          const monthName = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][month - 1];
          const period = allPeriods.find(p => p.month === month && p.year === year);
          if (!period) {
            monthResults.push({ month, year, applied: 0 });
            continue;
          }
          let applied = 0;
          for (const rec of recommendations) {
            let sku = rec.packagingType
              ? skus.find(s => s.name === rec.skuName && s.weight === rec.weight && (s as any).packagingType === rec.packagingType)
              : null;
            if (!sku) sku = skus.find(s => s.name === rec.skuName && s.weight === rec.weight);
            if (!sku) sku = skus.find(s => s.name === rec.skuName);
            if (!sku) continue;
            const value = rec.recommendedMastercases.toString();
            await db.upsertForecastData(sku.id, period.id, value);
            // Also write to IMS so it cascades to Planning FG
            await db.upsertImsData(sku.id, period.id, value, false);
            applied++;
          }
          totalApplied += applied;
          monthResults.push({ month, year, applied });
          await db.logAudit({
            username: getAuditActor(ctx),
            action: 'edit',
            country: typedCountry,
            sheet: 'Forecast',
            details: `Bulk applied AI forecast split for ${monthName} ${year} in ${typedCountry} — ${applied} SKUs updated (Forecast + IMS)`,
          });
        }
        return { success: true, totalApplied, monthResults };
      }),
  }),
  // ==================== TRADE OFFERS: POSM + FOC RULES ====================
  tradeOffers: router({
    // POSM list for a country (lazy-seeds a starter kit when empty).
    posmList: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getPosmItems(input.country);
      }),
    posmAdd: adminProcedure
      .input(z.object({
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        name: z.string().min(1).max(255),
        unitValue: z.number().nonnegative().nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        const row = await db.createPosmItem(input.country, { name: input.name, unitValue: input.unitValue ?? null });
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Trade Offers",
          details: `Added POSM item: ${input.name}`,
        });
        return row;
      }),
    posmUpdate: adminProcedure
      .input(z.object({
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        id: z.number().int(),
        name: z.string().min(1).max(255).optional(),
        unitValue: z.number().nonnegative().nullable().optional(),
        channelQty: z.record(z.string(), z.number().nonnegative()).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        await db.updatePosmItem(input.id, input.country, {
          name: input.name,
          unitValue: input.unitValue,
          channelQty: input.channelQty,
        });
        return { success: true };
      }),
    posmDelete: adminProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]), id: z.number().int() }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        await db.deletePosmItem(input.id, input.country);
        return { success: true };
      }),
    // Analyse POSM — the researcher: assign each material to the channels it
    // suits (AI when available, trade-practice keyword rules otherwise) and
    // persist priorities, suggested kit quantities and a one-line rationale.
    posmAnalyze: adminProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        const items = await db.getPosmItems(input.country);
        const named = items.filter(i => i.name.trim() !== "");
        const { fits, usedLLM } = await analyzePosmItems(named.map(i => ({ id: i.id, name: i.name })));
        const analyzedAt = new Date();
        for (const item of named) {
          const f = fits.get(item.id);
          if (!f) continue;
          await db.updatePosmItem(item.id, input.country, {
            channelQty: f.channelQty,
            priority: f.priority,
            rationale: f.rationale,
            analysisSource: f.source,
            analyzedAt,
          });
        }
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Trade Offers",
          details: `Analysed ${named.length} POSM item(s) — channel assignment via ${usedLLM ? "AI researcher" : "trade-practice rules"}`,
        });
        return { items: await db.getPosmItems(input.country), usedLLM };
      }),
    // FOC entitlement rules — one per (country, channel).
    focRules: protectedProcedure
      .input(z.object({ country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]) }))
      .query(async ({ ctx, input }) => {
        await requireCountryAccess(ctx, input.country);
        return db.getFocRules(input.country);
      }),
    focRuleUpsert: adminProcedure
      .input(z.object({
        country: z.enum(["Lebanon", "Syria", "Libya", "KSA"]),
        channel: z.enum(["retail", "wholesale", "semiWholesale", "horeca"]),
        entitled: z.boolean(),
        buyQty: z.number().positive().nullable().optional(),
        buyUnit: z.enum(["mc", "outer", "pack"]).nullable().optional(),
        freeQty: z.number().positive().nullable().optional(),
        freeUnit: z.enum(["mc", "outer", "pack"]).nullable().optional(),
        notes: z.string().max(400).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requireCountryAdmin(ctx, input.country);
        await db.upsertFocRule(input.country, input.channel, {
          entitled: input.entitled,
          buyQty: input.buyQty,
          buyUnit: input.buyUnit,
          freeQty: input.freeQty,
          freeUnit: input.freeUnit,
          notes: input.notes,
        });
        await db.logAudit({
          country: input.country,
          username: getAuditActor(ctx),
          action: "edit",
          sheet: "Trade Offers",
          details: `FOC rule for ${input.channel}: ${input.entitled ? `entitled — buy ${input.buyQty ?? "?"} ${input.buyUnit ?? "?"} → get ${input.freeQty ?? "?"} ${input.freeUnit ?? "?"} free` : "not entitled"}`,
        });
        return { success: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
