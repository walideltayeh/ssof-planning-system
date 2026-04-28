import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

// Mock the database module so authorization tests do not require a live DB.
// Each mocked function is a no-op stub that resolves successfully; the focus
// of these tests is the auth/role gating that runs *before* any DB work.
vi.mock("./db", () => {
  return {
    // Forecast cell edit
    upsertForecastData: vi.fn(async () => undefined),
    logAudit: vi.fn(async () => undefined),

    // SKU create
    createSku: vi.fn(async (data: { name: string; weight: string }) => ({
      id: 42,
      name: data.name,
      weight: data.weight,
    })),

    // App user management (owner-gated). The "admin-owner" username resolves
    // to an owner record so the admin caller can pass `requireAppOwner`. The
    // "admin-nonowner" username resolves to an admin record that is NOT an
    // owner, so it must be rejected by `requireAppOwner` even though it has
    // the admin role on the OAuth/session side. The viewer never reaches this
    // lookup because requireAppOwner rejects it on the isOwner check.
    getAppUserByUsername: vi.fn(async (username: string) => {
      if (username === "admin-owner") {
        return {
          id: 1,
          username: "admin-owner",
          displayName: "Admin Owner",
          role: "admin" as const,
          countries: JSON.stringify(["Lebanon"]),
          isOwner: true,
        };
      }
      if (username === "admin-nonowner") {
        return {
          id: 3,
          username: "admin-nonowner",
          displayName: "Admin Non-Owner",
          role: "admin" as const,
          countries: JSON.stringify(["Lebanon"]),
          isOwner: false,
        };
      }
      if (username === "viewer-user") {
        return {
          id: 2,
          username: "viewer-user",
          displayName: "Viewer User",
          role: "viewer" as const,
          countries: JSON.stringify(["Lebanon"]),
          isOwner: false,
        };
      }
      return null;
    }),
    deleteAppUser: vi.fn(async () => undefined),
    listAppUsers: vi.fn(async () => [
      {
        id: 1,
        username: "admin-owner",
        displayName: "Admin Owner",
        role: "admin" as const,
        countries: JSON.stringify(["Lebanon"]),
        isOwner: true,
        createdAt: new Date(),
      },
    ]),
    createAppUser: vi.fn(async () => undefined),
    updateAppUser: vi.fn(async () => undefined),

    // Bulk upload (forecast)
    getPeriodsForCountry: vi.fn(async () => [
      { id: 100, year: 2026, month: 1, label: "Jan 26", sortOrder: 0 },
    ]),
    ensurePeriods: vi.fn(async () => undefined),
    ensurePeriodsForCountry: vi.fn(async () => undefined),
    getSkusForCountry: vi.fn(async () => [
      { id: 7, name: "Sample SKU", weight: "1kg" },
    ]),
    createSkuForCountry: vi.fn(async () => ({ id: 7 })),
    bulkUpsertForecast: vi.fn(async () => undefined),

    // Per-SKU country lookup used by `requireSkuCountryAccess` for the
    // country.* mutations whose `country` field is optional. SKU id 7 is
    // owned by Syria here so a Lebanon-only caller must be rejected when
    // they try to mutate it without supplying a country.
    getSkuCountry: vi.fn(async (skuId: number) => {
      if (skuId === 7) return "Syria";
      if (skuId === 8) return "Lebanon";
      return null;
    }),
    deleteSku: vi.fn(async () => undefined),
    updateSkuPackagingType: vi.fn(async () => undefined),
    toggleSkuActive: vi.fn(async () => undefined),
    updateSkuDetails: vi.fn(async () => undefined),

    // Country-scoped read endpoints (Task #20). Stubbed so handlers reach
    // the `requireCountryAccess` gate without needing a real DB.
    getForecastDataForCountry: vi.fn(async () => []),
    getRevisedForecastDataForCountry: vi.fn(async () => []),
    getImsDataForCountry: vi.fn(async () => []),
    getShipmentDataForCountry: vi.fn(async () => []),
    getArrivalDataForCountry: vi.fn(async () => []),

    // Audit log feed (representative read endpoint covered by Task #15).
    // Returned shape mirrors db.getAuditLogs so the router can serialize it.
    getAuditLogs: vi.fn(async () => ({
      logs: [
        {
          id: 1,
          username: "admin-owner",
          action: "edit_cell",
          sheet: "Forecast",
          skuName: "Sample SKU",
          periodLabel: "Jan 26",
          field: "value",
          oldValue: "0",
          newValue: "10",
          details: "Changed from 0 to 10",
          country: "Lebanon",
          createdAt: new Date(),
        },
      ],
      total: 1,
    })),
  };
});

// Import the router AFTER vi.mock so it picks up the mocked db.
const { appRouter } = await import("./routers");

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function makeContext(user: AuthenticatedUser | null): TrpcContext {
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as unknown as TrpcContext["res"],
  };
}

function adminUser(): AuthenticatedUser {
  return {
    id: 1,
    openId: "admin-owner-openid",
    email: "owner@example.com",
    name: "admin-owner",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function nonOwnerAdminUser(): AuthenticatedUser {
  return {
    id: 3,
    openId: "admin-nonowner-openid",
    email: "nonowner@example.com",
    name: "admin-nonowner",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

function viewerUser(): AuthenticatedUser {
  return {
    id: 2,
    openId: "viewer-openid",
    email: "viewer@example.com",
    name: "viewer-user",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

const anonCaller = () => appRouter.createCaller(makeContext(null));
const viewerCaller = () => appRouter.createCaller(makeContext(viewerUser()));
const adminCaller = () => appRouter.createCaller(makeContext(adminUser()));
const nonOwnerAdminCaller = () =>
  appRouter.createCaller(makeContext(nonOwnerAdminUser()));

async function expectTrpcCode(promise: Promise<unknown>, code: TRPCError["code"]) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("authorization lockdown", () => {
  // ---------- 1. Forecast edit (protectedProcedure) ----------
  describe("update.forecastCell (protected: any signed-in user)", () => {
    const input = {
      skuId: 1,
      periodId: 1,
      value: "10",
      skuName: "Sample SKU",
      periodLabel: "Jan 26",
      oldValue: "0",
    };

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().update.forecastCell(input), "UNAUTHORIZED");
    });

    it("allows an authenticated viewer to edit forecast cells", async () => {
      const result = await viewerCaller().update.forecastCell(input);
      expect(result).toEqual({ success: true });
    });

    it("allows an authenticated admin to edit forecast cells", async () => {
      const result = await adminCaller().update.forecastCell(input);
      expect(result).toEqual({ success: true });
    });
  });

  // ---------- 2. SKU create (adminProcedure) ----------
  describe("skus.create (admin-only)", () => {
    const input = { name: "New SKU", weight: "1kg" } as const;

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().skus.create(input), "UNAUTHORIZED");
    });

    it("rejects authenticated viewers with FORBIDDEN", async () => {
      await expectTrpcCode(viewerCaller().skus.create(input), "FORBIDDEN");
    });

    it("allows authenticated admins to create SKUs", async () => {
      const result = await adminCaller().skus.create(input);
      expect(result).toMatchObject({ id: 42, name: "New SKU" });
    });
  });

  // ---------- 3. App user delete (protected + owner-gated) ----------
  describe("appUsers.delete (owner-only, admin role required in practice)", () => {
    const input = { id: 99 };

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().appUsers.delete(input), "UNAUTHORIZED");
    });

    it("rejects authenticated viewers with FORBIDDEN (not an owner)", async () => {
      await expectTrpcCode(viewerCaller().appUsers.delete(input), "FORBIDDEN");
    });

    it("rejects non-owner admins with FORBIDDEN", async () => {
      await expectTrpcCode(
        nonOwnerAdminCaller().appUsers.delete(input),
        "FORBIDDEN",
      );
    });

    it("allows the authenticated owner-admin to delete app users", async () => {
      const result = await adminCaller().appUsers.delete(input);
      expect(result).toEqual({ success: true });
    });
  });

  // ---------- 3a. App user list (owner-only) ----------
  describe("appUsers.list (owner-only)", () => {
    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().appUsers.list(), "UNAUTHORIZED");
    });

    it("rejects authenticated viewers with FORBIDDEN (not an owner)", async () => {
      await expectTrpcCode(viewerCaller().appUsers.list(), "FORBIDDEN");
    });

    it("rejects non-owner admins with FORBIDDEN", async () => {
      await expectTrpcCode(nonOwnerAdminCaller().appUsers.list(), "FORBIDDEN");
    });

    it("allows the authenticated owner-admin to list app users", async () => {
      const result = await adminCaller().appUsers.list();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 1,
        username: "admin-owner",
        isOwner: true,
      });
    });
  });

  // ---------- 3b. App user create (owner-only) ----------
  describe("appUsers.create (owner-only)", () => {
    const input = {
      username: "newuser",
      displayName: "New User",
      password: "secret",
      role: "viewer" as const,
      countries: ["Lebanon"],
    };

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().appUsers.create(input), "UNAUTHORIZED");
    });

    it("rejects authenticated viewers with FORBIDDEN (not an owner)", async () => {
      await expectTrpcCode(viewerCaller().appUsers.create(input), "FORBIDDEN");
    });

    it("rejects non-owner admins with FORBIDDEN", async () => {
      await expectTrpcCode(
        nonOwnerAdminCaller().appUsers.create(input),
        "FORBIDDEN",
      );
    });

    it("allows the authenticated owner-admin to create app users", async () => {
      const result = await adminCaller().appUsers.create(input);
      expect(result).toEqual({ success: true });
    });
  });

  // ---------- 3c. App user update (owner-only) ----------
  describe("appUsers.update (owner-only)", () => {
    const input = { id: 99, displayName: "Renamed" };

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().appUsers.update(input), "UNAUTHORIZED");
    });

    it("rejects authenticated viewers with FORBIDDEN (not an owner)", async () => {
      await expectTrpcCode(viewerCaller().appUsers.update(input), "FORBIDDEN");
    });

    it("rejects non-owner admins with FORBIDDEN", async () => {
      await expectTrpcCode(
        nonOwnerAdminCaller().appUsers.update(input),
        "FORBIDDEN",
      );
    });

    it("allows the authenticated owner-admin to update app users", async () => {
      const result = await adminCaller().appUsers.update(input);
      expect(result).toEqual({ success: true });
    });
  });

  // ---------- 4. Bulk upload (adminProcedure) ----------
  describe("upload.forecast (admin-only bulk upload)", () => {
    const input = {
      records: [
        {
          skuName: "Sample SKU",
          weight: "1kg",
          values: [{ year: 2026, month: 1, value: "100" }],
        },
      ],
      country: "Lebanon",
    };

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().upload.forecast(input), "UNAUTHORIZED");
    });

    it("rejects authenticated viewers with FORBIDDEN", async () => {
      await expectTrpcCode(viewerCaller().upload.forecast(input), "FORBIDDEN");
    });

    it("allows authenticated admins to run bulk forecast uploads", async () => {
      const result = await adminCaller().upload.forecast(input);
      expect(result).toMatchObject({ success: true });
    });
  });

  // ---------- 4a. Country-scoped read access (Task #20) ----------
  // The viewer-user mock above grants access to ["Lebanon"] only and
  // isOwner=false, so calling country.data with "Syria" or "Libya" must
  // be rejected with FORBIDDEN, while "Lebanon" must succeed. The
  // admin-owner mock has isOwner=true so it gets all three countries.
  describe("country.data (per-user country scoping)", () => {
    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(
        anonCaller().country.data({ country: "Syria" }),
        "UNAUTHORIZED",
      );
    });

    it("rejects a Lebanon-only viewer asking for Syria with FORBIDDEN", async () => {
      await expectTrpcCode(
        viewerCaller().country.data({ country: "Syria" }),
        "FORBIDDEN",
      );
      // The error message should name the country so the UI can surface a
      // helpful "you don't have access to <country>" empty state.
      await expect(
        viewerCaller().country.data({ country: "Syria" }),
      ).rejects.toThrow(/do not have access to Syria/i);
    });

    it("rejects a Lebanon-only non-owner admin asking for Libya with FORBIDDEN", async () => {
      await expectTrpcCode(
        nonOwnerAdminCaller().country.data({ country: "Libya" }),
        "FORBIDDEN",
      );
    });

    it("allows a Lebanon-only viewer to read Lebanon", async () => {
      const result = await viewerCaller().country.data({ country: "Lebanon" });
      expect(result).toMatchObject({
        skus: expect.any(Array),
        periods: expect.any(Array),
      });
    });

    it("allows the owner-admin to read every country", async () => {
      for (const country of ["Lebanon", "Syria", "Libya"] as const) {
        const result = await adminCaller().country.data({ country });
        expect(result).toMatchObject({
          skus: expect.any(Array),
          periods: expect.any(Array),
        });
      }
    });
  });

  // ---------- 4b. Per-SKU country gating (Task #23) ----------
  // The country.deleteSku mutation (and its sibling SKU mutations) used to
  // accept an optional `country` field that was only used for audit-log
  // attribution. When the field was omitted the per-country gate was
  // skipped, so an admin with access to Lebanon only could delete a SKU
  // that actually belongs to Syria. After Task #23 the handler resolves
  // the SKU's true country from the database and enforces
  // `requireCountryAccess` against it, regardless of what the caller
  // passes in.
  describe("country.deleteSku (resolves SKU's real country before gating)", () => {
    it("rejects a non-owner admin with FORBIDDEN when they omit `country` and the SKU belongs to a different country", async () => {
      // SKU id 7 is mocked as belonging to Syria. The non-owner admin only
      // has access to Lebanon, so this must fail even though `country` is
      // not provided in the input.
      await expectTrpcCode(
        nonOwnerAdminCaller().country.deleteSku({ skuId: 7 }),
        "FORBIDDEN",
      );
    });

    it("rejects a non-owner admin with FORBIDDEN when they pass a country they do have access to but the SKU belongs to another country", async () => {
      // The Lebanon-only admin tries to mask the cross-country mutation by
      // passing `country: "Lebanon"`. The handler resolves the SKU's real
      // country (Syria) and rejects.
      await expectTrpcCode(
        nonOwnerAdminCaller().country.deleteSku({ skuId: 7, country: "Lebanon" }),
        "FORBIDDEN",
      );
    });

    it("allows a non-owner admin to delete a SKU that actually belongs to their assigned country", async () => {
      // SKU id 8 is mocked as belonging to Lebanon, which the non-owner
      // admin does have access to.
      const result = await nonOwnerAdminCaller().country.deleteSku({ skuId: 8 });
      expect(result).toEqual({ success: true });
    });

    it("allows the owner-admin to delete any SKU regardless of country", async () => {
      const result = await adminCaller().country.deleteSku({ skuId: 7 });
      expect(result).toEqual({ success: true });
    });
  });

  // ---------- 5. Audit log feed (Task #15: read endpoints require sign-in) ----------
  // Representative read endpoint that exposes internal/company-confidential data.
  // Before Task #15 this used `publicProcedure`, allowing an unauthenticated
  // visitor to the deployed URL to pull the company's full audit trail.
  describe("audit.logs (read endpoint: any signed-in user)", () => {
    const input = { limit: 10 } as const;

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().audit.logs(input), "UNAUTHORIZED");
    });

    it("allows an authenticated viewer to read audit logs", async () => {
      const result = await viewerCaller().audit.logs(input);
      expect(result).toMatchObject({ total: 1 });
      expect(result.logs).toHaveLength(1);
    });

    it("allows an authenticated admin to read audit logs", async () => {
      const result = await adminCaller().audit.logs(input);
      expect(result).toMatchObject({ total: 1 });
      expect(result.logs).toHaveLength(1);
    });
  });
});
