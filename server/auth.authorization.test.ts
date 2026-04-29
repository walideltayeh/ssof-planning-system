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
    getAppUserById: vi.fn(async (id: number) => {
      if (id === 1) {
        return {
          id: 1,
          username: "admin-owner",
          displayName: "Admin Owner",
          role: "admin" as const,
          countries: JSON.stringify(["Lebanon"]),
          isOwner: true,
          email: "owner@example.com",
        };
      }
      return null;
    }),
    getRecentUserAuditChanges: vi.fn(async () => new Map()),
    listAppUsers: vi.fn(async () => [
      {
        id: 1,
        username: "admin-owner",
        displayName: "Admin Owner",
        role: "admin" as const,
        countries: JSON.stringify(["Lebanon"]),
        isOwner: true,
        email: "owner@example.com",
        createdAt: new Date(),
      },
    ]),
    listAppOwners: vi.fn(async () => [
      { displayName: "Admin Owner", email: "owner@example.com" },
    ]),
    createAppUser: vi.fn(async () => undefined),
    updateAppUser: vi.fn(async () => undefined),
    changeAppUserPassword: vi.fn(async () => ({ success: true })),

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

  // ---------- 3a-pre. App user owner list (any signed-in caller) ----------
  // `appUsers.listOwners` powers the "no country access" empty state on
  // CountrySelectorPage, which is shown to signed-in users who have no
  // country access — including viewers and non-owner admins. So this
  // endpoint must accept any authenticated caller (UNAUTHORIZED for anon)
  // but never leak passwords, role, or country lists.
  describe("appUsers.listOwners (any signed-in caller)", () => {
    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().appUsers.listOwners(), "UNAUTHORIZED");
    });

    it("allows authenticated viewers to read owner contact info", async () => {
      const result = await viewerCaller().appUsers.listOwners();
      expect(result).toEqual([
        { displayName: "Admin Owner", email: "owner@example.com" },
      ]);
    });

    it("allows authenticated admins (including non-owner admins) to read owner contact info", async () => {
      const result = await nonOwnerAdminCaller().appUsers.listOwners();
      expect(result).toEqual([
        { displayName: "Admin Owner", email: "owner@example.com" },
      ]);
    });

    it("returns only safe fields (display name + email) — no password / role / countries leak", async () => {
      const result = await viewerCaller().appUsers.listOwners();
      expect(result).toHaveLength(1);
      const owner = result[0] as Record<string, unknown>;
      expect(Object.keys(owner).sort()).toEqual(["displayName", "email"]);
      expect(owner).not.toHaveProperty("password");
      expect(owner).not.toHaveProperty("role");
      expect(owner).not.toHaveProperty("countries");
      expect(owner).not.toHaveProperty("isOwner");
      expect(owner).not.toHaveProperty("id");
      expect(owner).not.toHaveProperty("username");
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
      password: "secret123",
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

  // ---------- 3d. Password strength on appUsers.create / update ----------
  // The User Management form uses `checkPasswordStrength` from
  // `shared/passwordStrength.ts`, and the same rule is wired into the
  // `appUsers.create` and `appUsers.update` Zod schemas as a server-side
  // backstop. These tests pin that contract: a weak password (too short,
  // letters-only, or digits-only) must be rejected with BAD_REQUEST before
  // any DB write happens, and a strong password must pass through.
  describe("appUsers password strength validation (server-side backstop)", () => {
    const baseCreate = {
      username: "newuser",
      displayName: "New User",
      role: "viewer" as const,
      countries: ["Lebanon"],
    };

    describe("appUsers.create", () => {
      it("rejects a too-short password with BAD_REQUEST and never writes to the db", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          adminCaller().appUsers.create({ ...baseCreate, password: "a1b2" }),
          "BAD_REQUEST",
        );
        expect(db.createAppUser).not.toHaveBeenCalled();
        expect(db.logAudit).not.toHaveBeenCalled();
      });

      it("rejects a long password that contains no letters with BAD_REQUEST", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          adminCaller().appUsers.create({ ...baseCreate, password: "12345678" }),
          "BAD_REQUEST",
        );
        expect(db.createAppUser).not.toHaveBeenCalled();
      });

      it("rejects a long password that contains no digits with BAD_REQUEST", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          adminCaller().appUsers.create({ ...baseCreate, password: "abcdefgh" }),
          "BAD_REQUEST",
        );
        expect(db.createAppUser).not.toHaveBeenCalled();
      });

      it("accepts a strong password and forwards it to db.createAppUser", async () => {
        const db = await import("./db");
        const result = await adminCaller().appUsers.create({
          ...baseCreate,
          password: "secret123",
        });
        expect(result).toEqual({ success: true });
        expect(db.createAppUser).toHaveBeenCalledTimes(1);
        expect(db.createAppUser).toHaveBeenCalledWith(
          expect.objectContaining({
            username: "newuser",
            password: "secret123",
          }),
        );
      });
    });

    // Self-service Change Password dialog (DashboardLayout sidebar) hits
    // `appUsers.changePassword` instead of the owner-only `appUsers.update`,
    // so it needs its own server-side coverage. The Zod schema must reject
    // weak `newPassword` values with BAD_REQUEST + the shared requirements
    // message, even when the client-side check is bypassed (see Task #55).
    describe("appUsers.changePassword (self-service dialog backstop)", () => {
      // The self-service dialog only ever changes the *caller's own*
      // password (Task #59), so test inputs default to the caller's own
      // app-user id. Tests that intentionally exercise the cross-user
      // path override `userId` explicitly.
      const baseChange = {
        userId: 2, // viewer-user's own app-user id (see mocks above)
        currentPassword: "oldsecret1",
        confirmPassword: "secret123",
      };

      it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
        await expectTrpcCode(
          anonCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "secret123",
          }),
          "UNAUTHORIZED",
        );
      });

      // Task #59: the self-service Change Password dialog must only ever
      // change the *caller's own* password. Even if the caller knows the
      // current password of another user (e.g. a shared/temporary one),
      // they must not be able to silently lock that user out — and the
      // audit trail would otherwise misleadingly name the actor instead
      // of the victim. Cross-user resets only happen through the
      // owner-only `appUsers.update` path.
      describe("self-service only (Task #59)", () => {
        it("rejects a viewer trying to change another user's password with FORBIDDEN", async () => {
          const db = await import("./db");
          // viewer-user (id=2) tries to change admin-owner's password (id=1)
          await expectTrpcCode(
            viewerCaller().appUsers.changePassword({
              ...baseChange,
              userId: 1,
              newPassword: "secret123",
              confirmPassword: "secret123",
            }),
            "FORBIDDEN",
          );
          expect(db.changeAppUserPassword).not.toHaveBeenCalled();
          expect(db.logAudit).not.toHaveBeenCalled();
        });

        it("rejects an owner-admin trying to change another user's password with FORBIDDEN", async () => {
          const db = await import("./db");
          // admin-owner (id=1) tries to change viewer-user's password (id=2)
          // — even an owner must use `appUsers.update` for cross-user resets.
          await expectTrpcCode(
            adminCaller().appUsers.changePassword({
              ...baseChange,
              userId: 2,
              newPassword: "secret123",
              confirmPassword: "secret123",
            }),
            "FORBIDDEN",
          );
          expect(db.changeAppUserPassword).not.toHaveBeenCalled();
          expect(db.logAudit).not.toHaveBeenCalled();
        });

        it("rejects with FORBIDDEN when the caller has no matching app-user row", async () => {
          const db = await import("./db");
          // A signed-in caller whose username doesn't resolve to an app-user
          // (defensive case, e.g. an OAuth-only session) must also be
          // rejected — they cannot prove ownership of any userId.
          (db.getAppUserByUsername as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce(null);
          await expectTrpcCode(
            viewerCaller().appUsers.changePassword({
              ...baseChange,
              newPassword: "secret123",
              confirmPassword: "secret123",
            }),
            "FORBIDDEN",
          );
          expect(db.changeAppUserPassword).not.toHaveBeenCalled();
          expect(db.logAudit).not.toHaveBeenCalled();
        });
      });

      it("rejects a too-short newPassword with BAD_REQUEST and never writes to the db", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          viewerCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "a1b2",
            confirmPassword: "a1b2",
          }),
          "BAD_REQUEST",
        );
        expect(db.changeAppUserPassword).not.toHaveBeenCalled();
      });

      it("rejects a long newPassword with no letters with BAD_REQUEST", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          viewerCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "12345678",
            confirmPassword: "12345678",
          }),
          "BAD_REQUEST",
        );
        expect(db.changeAppUserPassword).not.toHaveBeenCalled();
      });

      it("rejects a long newPassword with no digits with BAD_REQUEST", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          viewerCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "abcdefgh",
            confirmPassword: "abcdefgh",
          }),
          "BAD_REQUEST",
        );
        expect(db.changeAppUserPassword).not.toHaveBeenCalled();
      });

      it("surfaces the shared PASSWORD_REQUIREMENTS_MESSAGE for a weak newPassword", async () => {
        const { PASSWORD_REQUIREMENTS_MESSAGE } = await import(
          "@shared/passwordStrength"
        );
        await expect(
          viewerCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "abcdefgh",
            confirmPassword: "abcdefgh",
          }),
        ).rejects.toThrow(
          new RegExp(
            PASSWORD_REQUIREMENTS_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
          ),
        );
      });

      it("accepts a strong newPassword and forwards it to db.changeAppUserPassword", async () => {
        const db = await import("./db");
        const result = await viewerCaller().appUsers.changePassword({
          ...baseChange,
          newPassword: "secret123",
          confirmPassword: "secret123",
        });
        expect(result).toEqual({ success: true });
        expect(db.changeAppUserPassword).toHaveBeenCalledTimes(1);
        expect(db.changeAppUserPassword).toHaveBeenCalledWith(
          baseChange.userId,
          baseChange.currentPassword,
          "secret123",
        );
      });

      // Task #58: a successful self-service password change must be written
      // to the audit trail so the Audit Trail page can show who changed
      // their own password and when. Failures (mismatched confirmation,
      // wrong current password, etc.) must NOT log audit entries.
      describe("audit trail logging (Task #58)", () => {
        it("writes a 'change_password' audit entry naming the actor on success", async () => {
          const db = await import("./db");
          // Caller is "admin-owner" (id=1) changing their *own* password,
          // so userId must match the admin caller's id — Task #59 forbids
          // cross-user changes through this endpoint. The audit details
          // should phrase it as a self-service ("Changed own password")
          // entry because actor and target are the same user.
          const result = await adminCaller().appUsers.changePassword({
            ...baseChange,
            userId: 1,
            newPassword: "secret123",
            confirmPassword: "secret123",
          });
          expect(result).toEqual({ success: true });
          expect(db.logAudit).toHaveBeenCalledTimes(1);
          expect(db.logAudit).toHaveBeenCalledWith(
            expect.objectContaining({
              username: "admin-owner",
              action: "change_password",
              sheet: "Users",
              details: expect.stringContaining("admin-owner"),
            }),
          );
          const call = (db.logAudit as ReturnType<typeof vi.fn>).mock.calls[0][0];
          expect(call.details).toMatch(/Changed own password/);
          expect(call.details).toContain("id=1");
        });

        it("does NOT write an audit entry when the current password is wrong", async () => {
          const db = await import("./db");
          (db.changeAppUserPassword as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
            success: false,
            error: "Current password is incorrect",
          });
          const result = await viewerCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "secret123",
            confirmPassword: "secret123",
          });
          expect(result).toEqual({
            success: false,
            error: "Current password is incorrect",
          });
          expect(db.logAudit).not.toHaveBeenCalled();
        });

        it("does NOT write an audit entry when newPassword !== confirmPassword", async () => {
          const db = await import("./db");
          const result = await viewerCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "secret123",
            confirmPassword: "different1",
          });
          expect(result).toMatchObject({ success: false });
          expect(db.changeAppUserPassword).not.toHaveBeenCalled();
          expect(db.logAudit).not.toHaveBeenCalled();
        });
      });

      it("blocks the db write before mismatch handling when newPassword is weak", async () => {
        // Even when newPassword !== confirmPassword (which the handler
        // would normally surface as a friendly { success:false } error),
        // a weak newPassword must short-circuit at the Zod layer with
        // BAD_REQUEST so the db never sees the call at all.
        const db = await import("./db");
        await expectTrpcCode(
          viewerCaller().appUsers.changePassword({
            ...baseChange,
            newPassword: "a1b2",
            confirmPassword: "totally-different",
          }),
          "BAD_REQUEST",
        );
        expect(db.changeAppUserPassword).not.toHaveBeenCalled();
      });
    });

    describe("appUsers.update", () => {
      it("rejects a too-short password with BAD_REQUEST and never writes to the db", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          adminCaller().appUsers.update({ id: 1, password: "a1b2" }),
          "BAD_REQUEST",
        );
        expect(db.updateAppUser).not.toHaveBeenCalled();
      });

      it("rejects a long password that contains no letters with BAD_REQUEST", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          adminCaller().appUsers.update({ id: 1, password: "12345678" }),
          "BAD_REQUEST",
        );
        expect(db.updateAppUser).not.toHaveBeenCalled();
      });

      it("rejects a long password that contains no digits with BAD_REQUEST", async () => {
        const db = await import("./db");
        await expectTrpcCode(
          adminCaller().appUsers.update({ id: 1, password: "abcdefgh" }),
          "BAD_REQUEST",
        );
        expect(db.updateAppUser).not.toHaveBeenCalled();
      });

      it("accepts an update with no password (password remains optional)", async () => {
        const db = await import("./db");
        const result = await adminCaller().appUsers.update({
          id: 1,
          displayName: "Renamed",
        });
        expect(result).toEqual({ success: true });
        expect(db.updateAppUser).toHaveBeenCalledTimes(1);
        expect(db.updateAppUser).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ password: undefined }),
        );
      });

      it("accepts a strong password and forwards it to db.updateAppUser", async () => {
        const db = await import("./db");
        const result = await adminCaller().appUsers.update({
          id: 1,
          password: "secret123",
        });
        expect(result).toEqual({ success: true });
        expect(db.updateAppUser).toHaveBeenCalledTimes(1);
        expect(db.updateAppUser).toHaveBeenCalledWith(
          1,
          expect.objectContaining({ password: "secret123" }),
        );
      });
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
