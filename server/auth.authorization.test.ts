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

    // App user delete (owner-gated). The "admin-owner" username resolves to
    // an owner record so the admin caller can pass `requireAppOwner`. The
    // viewer never reaches this lookup because adminProcedure / requireAppOwner
    // rejects them first.
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

    // Bulk upload (forecast)
    getPeriodsForCountry: vi.fn(async () => [
      { id: 100, year: 2026, month: 1, label: "Jan 26", sortOrder: 0 },
    ]),
    ensurePeriods: vi.fn(async () => undefined),
    getSkusForCountry: vi.fn(async () => [
      { id: 7, name: "Sample SKU", weight: "1kg" },
    ]),
    createSkuForCountry: vi.fn(async () => ({ id: 7 })),
    bulkUpsertForecast: vi.fn(async () => undefined),

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

    it("allows the authenticated owner-admin to delete app users", async () => {
      const result = await adminCaller().appUsers.delete(input);
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
