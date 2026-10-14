import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const account = { id: 2, username: "viewer", password: "test-password", isPaused: false, isOwner: false, countries: '["Syria"]' };
  return { account };
});
vi.mock("pg", () => ({ Pool: class { on() {} } }));
vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [m.account] }) }) }) }),
}));
import { verifyAppUserLogin, verifyAppUserLoginNoCountry } from "./db";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/test");
  m.account.isPaused = false;
});
afterEach(() => vi.unstubAllEnvs());
describe("paused login", () => {
  it("rejects valid passwords on both login paths while paused, and restores normal access on resume", async () => {
    m.account.isPaused = true;
    for (const result of [await verifyAppUserLogin("viewer", "test-password", "Syria"), await verifyAppUserLoginNoCountry("viewer", "test-password")]) {
      expect(result.success).toBe(false);
      expect(result.error).toContain("account is paused");
      expect(result.user).toBeUndefined();
    }
    m.account.isPaused = false;
    expect((await verifyAppUserLogin("viewer", "test-password", "Syria")).success).toBe(true);
    expect((await verifyAppUserLoginNoCountry("viewer", "test-password")).success).toBe(true);
  });
  it("does not disclose pause status for an incorrect password", async () => {
    m.account.isPaused = true;
    expect(await verifyAppUserLoginNoCountry("viewer", "wrong")).toEqual({ success: false, error: "Invalid username or password" });
  });
});
