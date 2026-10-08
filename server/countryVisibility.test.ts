import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { appSettings, auditTrail, COUNTRIES } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(),
  getDb: vi.fn(), getAppUserByUsername: vi.fn(),
  getVersionById: vi.fn(async () => ({ id: 1, country: "Libya", snapshotData: { foc: [] } })),
  listVersions: vi.fn(async () => [{ id: 1, country: "Libya" }, { id: 2, country: "Syria" }]),
}));
const db = await import("./db");
const visibility = await import("./countryVisibility");
const { appRouter, requireCountryAccess, requireCountryAdmin } = await import("./routers");
const dialect = new PgDialect();
let settings: { key: string; value: string }[], audits: any[], failAudit: boolean;
const owner = { username: "Test owner", countries: "[]", isOwner: true, role: "admin", countryRoles: null } as const;
let requester: any = owner;
const ctx = () => ({ user: { id: 1, name: requester.username, role: "admin" }, req: {}, res: {} }) as TrpcContext;
const caller = () => appRouter.createCaller(ctx());
const connection = {
  select: () => ({
    from: (table: unknown) => ({
      where: async (condition: any) => {
        expect(table).toBe(appSettings);
        const keys = dialect.sqlToQuery(condition).params;
        return structuredClone(settings.filter(row => keys.includes(row.key)));
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (row: any) => {
      if (table === auditTrail) {
        if (failAudit) return Promise.reject(new Error("Audit unavailable"));
        audits.push(structuredClone(row));
        return Promise.resolve();
      }
      expect(table).toBe(appSettings); // Any attempted writes to planning data fail this test.
      return { onConflictDoUpdate: async ({ set }: any) => {
        const old = settings.find(s => s.key === row.key);
        if (old) Object.assign(old, set); else settings.push(structuredClone(row));
      } };
    },
  }),
  transaction: async (fn: (tx: any) => Promise<any>) => {
    const before = structuredClone({ settings, audits });
    try { return await fn(connection); }
    catch (error) { settings = before.settings; audits = before.audits; throw error; }
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  requester = owner; failAudit = false; audits = [];
  settings = [{ key: "jwt_signing_secret", value: "synthetic-secret-not-for-response" }];
  vi.mocked(db.getDb).mockResolvedValue(connection as any);
  vi.mocked(db.getAppUserByUsername).mockImplementation(async () => requester);
});

describe("reversible country availability for everyone", () => {
  it("defaults all countries to visible and reads only non-secret visibility keys", async () => {
    const result = await caller().countryVisibility.list();
    expect(result).toEqual(COUNTRIES.map(country => ({ country, isHidden: false, canManage: true })));
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    expect(settings).toHaveLength(1);
  });
  it("hides and restores persistently, blocks even owners, and audits without writing country data", async () => {
    await caller().countryVisibility.setHidden({ country: "Libya", hidden: true });
    expect((await caller().countryVisibility.list()).find(c => c.country === "Libya")).toMatchObject({ isHidden: true, canManage: true });
    await expect(requireCountryAccess(ctx() as any, "Libya")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireCountryAdmin(ctx() as any, "Libya")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().country.data({ country: "Libya" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().focPlanning.list({ country: "Libya", includeFoc: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().versions.export({ id: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().versions.compare({ versionAId: 1, versionBId: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller().versions.list()).map(version => version.country)).toEqual(["Syria"]);
    await caller().countryVisibility.setHidden({ country: "Libya", hidden: false });
    await expect(requireCountryAccess(ctx() as any, "Libya")).resolves.toBeUndefined();
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ country: "Libya", username: "Test owner", action: "country_visibility", oldValue: "Visible", newValue: "Hidden" });
    expect(audits[1]).toMatchObject({ oldValue: "Hidden", newValue: "Visible" });
    expect(settings.find(s => s.key === "jwt_signing_secret")?.value).toBe("synthetic-secret-not-for-response");
  });
  it("also blocks legacy Lebanon analysis APIs which have no country input", async () => {
    await caller().countryVisibility.setHidden({ country: "Lebanon", hidden: true });
    await expect(caller().analysis.overview()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().analysis.stockSnapshot()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps management accessible when every country is hidden", async () => {
    for (const country of COUNTRIES) await caller().countryVisibility.setHidden({ country, hidden: true });
    expect((await caller().countryVisibility.list()).every(c => c.isHidden && c.canManage)).toBe(true);
    await caller().countryVisibility.setHidden({ country: "Syria", hidden: false });
    await expect(requireCountryAdmin(ctx() as any, "Syria")).resolves.toBeUndefined();
  });
  it("permits only assigned country administrators, including per-country overrides", async () => {
    requester = { ...owner, isOwner: false, countries: JSON.stringify(["Libya", "Syria"]),
      role: "viewer", countryRoles: JSON.stringify({ Libya: "admin", Syria: "viewer" }) };
    const list = await caller().countryVisibility.list();
    expect(list.filter(c => c.canManage).map(c => c.country)).toEqual(["Libya"]);
    await expect(caller().countryVisibility.setHidden({ country: "Syria", hidden: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().countryVisibility.setHidden({ country: "Lebanon", hidden: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await caller().countryVisibility.setHidden({ country: "Libya", hidden: true });
    await caller().countryVisibility.setHidden({ country: "Libya", hidden: false });
    requester.countryRoles = JSON.stringify({ Libya: "viewer" });
    await expect(caller().countryVisibility.setHidden({ country: "Libya", hidden: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects anonymous/viewer mutations, unknown countries and arbitrary settings keys", async () => {
    requester = { ...owner, isOwner: false, role: "viewer", countries: JSON.stringify(COUNTRIES) };
    await expect(caller().countryVisibility.setHidden({ country: "Libya", hidden: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const anonymous = appRouter.createCaller({ ...ctx(), user: null });
    await expect(anonymous.countryVisibility.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.countryVisibility.setHidden({ country: "Libya", hidden: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    requester = owner;
    await expect(caller().countryVisibility.setHidden({ country: "Unknown", hidden: true } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().countryVisibility.setHidden({ country: "Libya", hidden: true, key: "jwt_signing_secret" } as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(audits).toEqual([]);
  });
  it("rolls back a visibility change if its audit cannot be saved and treats repeats as no-ops", async () => {
    failAudit = true;
    await expect(caller().countryVisibility.setHidden({ country: "Libya", hidden: true })).rejects.toThrow("Audit unavailable");
    expect((await visibility.hiddenCountries()).has("Libya")).toBe(false);
    failAudit = false;
    await caller().countryVisibility.setHidden({ country: "Libya", hidden: true });
    await caller().countryVisibility.setHidden({ country: "Libya", hidden: true });
    expect(audits).toHaveLength(1);
  });
  it("fails closed on unavailable or invalid settings instead of allowing data access", async () => {
    vi.mocked(db.getDb).mockResolvedValue(null);
    await expect(requireCountryAccess(ctx() as any, "Libya")).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    vi.mocked(db.getDb).mockResolvedValue(connection as any);
    settings.push({ key: "country.visibility.Libya", value: "not-a-valid-flag" });
    await expect(requireCountryAccess(ctx() as any, "Libya")).rejects.toThrow("Invalid country availability");
  });
});
