import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "./_core/context";

type PresenceRow = {
  username: string;
  displayName: string;
  country: string;
  currentPage: string;
  lastSeen: Date;
};

const presenceStore = new Map<string, PresenceRow>();

vi.mock("./db", () => {
  return {
    upsertPresence: vi.fn(
      async (data: {
        username: string;
        displayName: string;
        country: string;
        currentPage: string;
      }) => {
        presenceStore.set(data.username, {
          username: data.username,
          displayName: data.displayName,
          country: data.country,
          currentPage: data.currentPage,
          lastSeen: new Date(),
        });
      },
    ),
    getOnlineUsers: vi.fn(async () => Array.from(presenceStore.values())),
    removePresence: vi.fn(async (username: string) => {
      presenceStore.delete(username);
    }),
    getAppUserByUsername: vi.fn(async (username: string) => {
      if (username === "alice") {
        return {
          id: 1,
          username: "alice",
          displayName: "Alice Adams",
          role: "admin" as const,
          countries: JSON.stringify(["Lebanon"]),
          isOwner: true,
        };
      }
      if (username === "bob-no-display") {
        return {
          id: 2,
          username: "bob-no-display",
          displayName: "",
          role: "viewer" as const,
          countries: JSON.stringify(["Lebanon"]),
          isOwner: false,
        };
      }
      if (username === "carol-unlinked") {
        return null;
      }
      return null;
    }),
    logAudit: vi.fn(async () => undefined),
  };
});

const { appRouter } = await import("./routers");
const db = await import("./db");

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

function authedUser(name: string): AuthenticatedUser {
  return {
    id: 1,
    openId: `${name}-openid`,
    email: `${name}@example.com`,
    name,
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
}

const anonCaller = () => appRouter.createCaller(makeContext(null));
const callerAs = (name: string) =>
  appRouter.createCaller(makeContext(authedUser(name)));

async function expectTrpcCode(promise: Promise<unknown>, code: TRPCError["code"]) {
  await expect(promise).rejects.toMatchObject({ code });
}

beforeEach(() => {
  presenceStore.clear();
  vi.clearAllMocks();
});

describe("presence router", () => {
  // ---------- heartbeat ----------
  describe("presence.heartbeat", () => {
    const baseInput = { country: "Lebanon", currentPage: "/forecast" };

    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(
        anonCaller().presence.heartbeat(baseInput),
        "UNAUTHORIZED",
      );
      expect(db.upsertPresence).not.toHaveBeenCalled();
    });

    it("writes the presence row keyed by ctx.user.name with the linked app-user displayName", async () => {
      const result = await callerAs("alice").presence.heartbeat(baseInput);
      expect(result).toEqual({ success: true });

      expect(db.upsertPresence).toHaveBeenCalledTimes(1);
      expect(db.upsertPresence).toHaveBeenCalledWith({
        username: "alice",
        displayName: "Alice Adams",
        country: "Lebanon",
        currentPage: "/forecast",
      });
    });

    it("falls back to the username when the linked app-user has no displayName", async () => {
      await callerAs("bob-no-display").presence.heartbeat(baseInput);

      expect(db.upsertPresence).toHaveBeenCalledWith({
        username: "bob-no-display",
        displayName: "bob-no-display",
        country: "Lebanon",
        currentPage: "/forecast",
      });
    });

    it("falls back to the username when no app-user record is linked at all", async () => {
      await callerAs("carol-unlinked").presence.heartbeat(baseInput);

      expect(db.upsertPresence).toHaveBeenCalledWith({
        username: "carol-unlinked",
        displayName: "carol-unlinked",
        country: "Lebanon",
        currentPage: "/forecast",
      });
    });

    it("ignores any client-supplied username/displayName and still writes ctx.user identity", async () => {
      // The Zod schema does not declare username/displayName, but a hostile
      // client could still include them. The router must not pick them up.
      const hostileInput = {
        ...baseInput,
        username: "victim",
        displayName: "Victim Display",
      } as unknown as { country: string; currentPage: string };

      await callerAs("alice").presence.heartbeat(hostileInput);

      expect(db.upsertPresence).toHaveBeenCalledTimes(1);
      const call = (db.upsertPresence as unknown as { mock: { calls: unknown[][] } })
        .mock.calls[0]![0] as { username: string; displayName: string };
      expect(call.username).toBe("alice");
      expect(call.displayName).toBe("Alice Adams");
      expect(call.username).not.toBe("victim");
      expect(call.displayName).not.toBe("Victim Display");
    });
  });

  // ---------- online ----------
  describe("presence.online", () => {
    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().presence.online(), "UNAUTHORIZED");
    });

    it("returns the rows produced by heartbeat", async () => {
      await callerAs("alice").presence.heartbeat({
        country: "Lebanon",
        currentPage: "/forecast",
      });
      await callerAs("bob-no-display").presence.heartbeat({
        country: "Syria",
        currentPage: "/planning",
      });

      const rows = await callerAs("alice").presence.online();
      expect(rows).toHaveLength(2);

      const byUsername = new Map(rows.map((r) => [r.username, r]));
      expect(byUsername.get("alice")).toMatchObject({
        username: "alice",
        displayName: "Alice Adams",
        country: "Lebanon",
        currentPage: "/forecast",
      });
      expect(byUsername.get("bob-no-display")).toMatchObject({
        username: "bob-no-display",
        displayName: "bob-no-display",
        country: "Syria",
        currentPage: "/planning",
      });
    });
  });

  // ---------- leave ----------
  describe("presence.leave", () => {
    it("rejects unauthenticated callers with UNAUTHORIZED", async () => {
      await expectTrpcCode(anonCaller().presence.leave(), "UNAUTHORIZED");
      expect(db.removePresence).not.toHaveBeenCalled();
    });

    it("only removes the caller's own presence row, not anyone else's", async () => {
      await callerAs("alice").presence.heartbeat({
        country: "Lebanon",
        currentPage: "/forecast",
      });
      await callerAs("bob-no-display").presence.heartbeat({
        country: "Syria",
        currentPage: "/planning",
      });
      expect(presenceStore.size).toBe(2);

      const result = await callerAs("alice").presence.leave();
      expect(result).toEqual({ success: true });

      expect(db.removePresence).toHaveBeenCalledTimes(1);
      expect(db.removePresence).toHaveBeenCalledWith("alice");

      // Bob's row must still be present — the caller cannot evict another user.
      expect(presenceStore.has("alice")).toBe(false);
      expect(presenceStore.has("bob-no-display")).toBe(true);
    });
  });
});
