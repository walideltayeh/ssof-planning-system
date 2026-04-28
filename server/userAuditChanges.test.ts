import { describe, expect, it } from "vitest";
import { pickRecentUserAuditChanges } from "./db";

type FakeLog = {
  id: number;
  details: string | null;
  username: string;
  action: string;
  createdAt: Date;
};

const t = (offsetSec: number) => new Date(Date.UTC(2026, 0, 1) + offsetSec * 1000);

describe("pickRecentUserAuditChanges", () => {
  const users = [
    { id: 1, username: "walid" },
    { id: 2, username: "elias" },
    { id: 3, username: "amal" },
  ];

  it("returns an empty map when there are no users or no logs", () => {
    expect(pickRecentUserAuditChanges([] as FakeLog[], users).size).toBe(0);
    expect(pickRecentUserAuditChanges<FakeLog>(
      [{ id: 1, details: "Updated user 'elias' (id=2)", username: "walid", action: "update_user", createdAt: t(10) }],
      [],
    ).size).toBe(0);
  });

  it("matches the new format that embeds both username and id", () => {
    const logs: FakeLog[] = [
      { id: 10, details: "Updated user 'elias' (id=2): role 'viewer' → 'admin'", username: "walid", action: "update_user", createdAt: t(20) },
    ];
    const out = pickRecentUserAuditChanges(logs, users);
    expect(out.get(2)?.id).toBe(10);
  });

  it("matches the legacy `id=N` only format", () => {
    const logs: FakeLog[] = [
      { id: 11, details: "Updated user id=2: displayName=Elias K", username: "walid", action: "update_user", createdAt: t(20) },
    ];
    const out = pickRecentUserAuditChanges(logs, users);
    expect(out.get(2)?.id).toBe(11);
  });

  it("matches the create-user format which only carries the username", () => {
    const logs: FakeLog[] = [
      { id: 12, details: "Created user 'amal' (viewer) with access to Lebanon", username: "walid", action: "create_user", createdAt: t(30) },
    ];
    const out = pickRecentUserAuditChanges(logs, users);
    expect(out.get(3)?.id).toBe(12);
  });

  it("returns only the newest entry per user when multiple match (input is newest-first)", () => {
    const logs: FakeLog[] = [
      { id: 100, details: "Updated user 'elias' (id=2): role 'viewer' → 'admin'", username: "walid", action: "update_user", createdAt: t(300) },
      { id: 99,  details: "Updated user id=2: displayName=Elias", username: "walid", action: "update_user", createdAt: t(200) },
      { id: 98,  details: "Created user 'elias' (viewer) with access to Lebanon", username: "walid", action: "create_user", createdAt: t(100) },
    ];
    const out = pickRecentUserAuditChanges(logs, users);
    expect(out.get(2)?.id).toBe(100);
  });

  it("ignores logs for unknown users (deleted users no longer in the roster)", () => {
    const logs: FakeLog[] = [
      { id: 50, details: "Deleted user id=999", username: "walid", action: "delete_user", createdAt: t(10) },
      { id: 51, details: "Updated user 'ghost'", username: "walid", action: "update_user", createdAt: t(20) },
    ];
    const out = pickRecentUserAuditChanges(logs, users);
    expect(out.size).toBe(0);
  });

  it("is case-insensitive on the parsed username", () => {
    const logs: FakeLog[] = [
      { id: 60, details: "Created user 'WALID' (admin) with access to Lebanon", username: "system", action: "create_user", createdAt: t(5) },
    ];
    const out = pickRecentUserAuditChanges(logs, users);
    expect(out.get(1)?.id).toBe(60);
  });

  it("prefers id=N over a username when both appear", () => {
    const logs: FakeLog[] = [
      // id refers to user 2 (elias) but the quoted username says "amal" — id wins.
      { id: 70, details: "Updated user 'amal' (id=2): role 'viewer' → 'admin'", username: "walid", action: "update_user", createdAt: t(15) },
    ];
    const out = pickRecentUserAuditChanges(logs, users);
    expect(out.get(2)?.id).toBe(70);
    expect(out.get(3)).toBeUndefined();
  });

  it("treats null details as a non-match instead of throwing", () => {
    const logs: FakeLog[] = [
      { id: 80, details: null, username: "walid", action: "update_user", createdAt: t(10) },
    ];
    expect(pickRecentUserAuditChanges(logs, users).size).toBe(0);
  });
});
