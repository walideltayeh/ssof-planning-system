import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
import type { Request } from "express";
import { ACCOUNT_PAUSED_MESSAGE } from "@shared/const";

const m = vi.hoisted(() => {
  const owner = { id: 1, username: "owner", isOwner: true, isPaused: false };
  const target = { id: 2, username: "viewer", isOwner: false, isPaused: false, countries: '["Syria"]', countryRoles: '{"Syria":"viewer"}' };
  return { owner, target, found: true, getUser: vi.fn(), setPaused: vi.fn(), audit: vi.fn(), upsert: vi.fn() };
});
vi.mock("./db", () => ({
  getAppUserByUsername: vi.fn(async (name: string) => name === "owner" ? m.owner : m.found ? m.target : null),
  getAppUserById: vi.fn(async (id: number) => id === 1 ? m.owner : id === 2 && m.found ? m.target : null),
  getUserByOpenId: m.getUser,
  setAppUserPaused: m.setPaused,
  logAudit: m.audit,
  upsertUser: m.upsert,
}));

import { appRouter, requireCountryAccess, requireCountryAdmin } from "./routers";
import { sdk } from "./_core/sdk";

function user(name: string, role: "admin" | "user" = "user") {
  return { id: 9, openId: `appuser:${name}`, name, role, email: null, loginMethod: "app-user",
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
}
function caller(name: string | null) {
  return appRouter.createCaller({
    user: name ? user(name, name === "owner" ? "admin" : "user") : null,
    req: { headers: {} }, res: {},
  } as TrpcContext);
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  m.target.isPaused = false;
  m.found = true;
  m.getUser.mockResolvedValue(user("viewer"));
  m.setPaused.mockImplementation(async (_id: number, paused: boolean) => { m.target.isPaused = paused; });
});

describe("reversible user pause", () => {
  it("lets the owner pause and resume without changing country permissions, and audits both", async () => {
    await expect(caller("owner").appUsers.setPaused({ id: 2, isPaused: true })).resolves.toEqual({ success: true, isPaused: true });
    expect(m.audit).toHaveBeenLastCalledWith(expect.objectContaining({ username: "owner", action: "pause_user", sheet: "Users", details: expect.stringContaining("'viewer' (id=2)") }));
    await expect(caller("owner").appUsers.setPaused({ id: 2, isPaused: false })).resolves.toEqual({ success: true, isPaused: false });
    expect(m.audit).toHaveBeenLastCalledWith(expect.objectContaining({ action: "resume_user" }));
    expect(m.target.countries).toBe('["Syria"]');
    expect(m.target.countryRoles).toBe('{"Syria":"viewer"}');
  });
  it("rejects anonymous users, non-owners and owner targets before writing", async () => {
    await expect(caller(null).appUsers.setPaused({ id: 2, isPaused: true })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller("viewer").appUsers.setPaused({ id: 2, isPaused: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("owner").appUsers.setPaused({ id: 1, isPaused: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(m.setPaused).not.toHaveBeenCalled();
  });
  it("reports missing users and keeps repeated requests idempotent", async () => {
    m.found = false;
    await expect(caller("owner").appUsers.setPaused({ id: 2, isPaused: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    m.found = true;
    await caller("owner").appUsers.setPaused({ id: 2, isPaused: false });
    expect(m.setPaused).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it("blocks paused accounts in both country read and admin gates", async () => {
    m.target.isPaused = true;
    const ctx = { user: user("viewer", "admin") };
    await expect(requireCountryAccess(ctx, "Syria")).rejects.toMatchObject({ code: "UNAUTHORIZED", message: ACCOUNT_PAUSED_MESSAGE });
    await expect(requireCountryAdmin(ctx, "Syria")).rejects.toMatchObject({ code: "UNAUTHORIZED", message: ACCOUNT_PAUSED_MESSAGE });
  });
  it("rejects an already-issued cookie while paused and accepts it after resume", async () => {
    vi.spyOn(sdk, "verifySession").mockResolvedValue({ openId: "appuser:viewer", name: "viewer", appId: "ssof-app-user" });
    const req = { headers: { cookie: "app_session_id=test-cookie" } } as Request;
    m.target.isPaused = true;
    await expect(sdk.authenticateRequest(req)).rejects.toMatchObject({ message: ACCOUNT_PAUSED_MESSAGE });
    expect(m.upsert).not.toHaveBeenCalled();
    m.target.isPaused = false;
    await expect(sdk.authenticateRequest(req)).resolves.toMatchObject({ name: "viewer" });
  });
  it("does not accept a cookie for a deleted app account", async () => {
    vi.spyOn(sdk, "verifySession").mockResolvedValue({ openId: "appuser:viewer", name: "viewer", appId: "ssof-app-user" });
    m.found = false;
    await expect(sdk.authenticateRequest({ headers: {} } as Request)).rejects.toMatchObject({ message: "User account no longer exists" });
  });
});
