import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { skus, periods, focData, arrivalData, planningFgData, clearanceEvents, auditTrail } from "../drizzle/schema";
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(), getDb: vi.fn() }));
const dbModule = await import("./db");
const service = await import("./focReceiptService");
const dialect = new PgDialect();

/** In-memory Drizzle adapter keeps the service's real scopes, evidence, tokens,
 * transaction rollback and audit operations under test without a database. */
let records: Map<unknown, any[]>;
function matches(row: any, where: any) {
  if (!where) return true;
  const q = dialect.sqlToQuery(where);
  return [...q.sql.matchAll(/\."([^"]+)" = \$(\d+)/g)].every(m => {
    const value = row[m[1]] ?? (m[1] === "country" ? records.get(skus)!.find(s => s.id === row.skuId)?.country : undefined);
    return value === q.params[Number(m[2]) - 1];
  });
}
class Query {
  table: unknown; condition: any; wrap = false;
  constructor(selection?: any) { this.wrap = !!selection?.row; }
  from(t: unknown) { this.table = t; return this; }
  where(c: any) { this.condition = c; return this; }
  orderBy() { return this; }
  innerJoin() { return this; }
  for() { return this; }
  then(resolve: any, reject: any) {
    return Promise.resolve((records.get(this.table) ?? []).filter(r => matches(r, this.condition))
      .map(r => this.wrap ? { row: { ...r } } : { ...r })).then(resolve, reject);
  }
}
const connection = {
  select: (s?: any) => new Query(s),
  update: (table: unknown) => ({ set: (patch: any) => ({ where: async (where: any) => {
    for (const row of records.get(table) ?? []) if (matches(row, where)) Object.assign(row, patch);
  } }) }),
  insert: (table: unknown) => ({ values: async (row: any) => {
    if (table !== auditTrail) throw new Error("FOC receipts must not write clearance/arrival rows");
    records.get(table)!.push({ ...row, createdAt: new Date() });
  } }),
  transaction: async (fn: (tx: any) => Promise<any>) => {
    const snapshot = structuredClone([...records.entries()].map(([table, rows]) => rows));
    const tables = [...records.keys()];
    try { return await fn(connection); }
    catch (e) { tables.forEach((t, i) => records.set(t, snapshot[i])); throw e; }
  },
};
beforeEach(() => {
  records = new Map<unknown, any[]>([
    [skus, [{ id: 1, country: "Libya", isActive: true, name: "Mint", weight: "50g", sortOrder: 1 }]],
    [periods, [9, 10, 11, 12].map(m => ({ id: m, country: "Libya", year: 2026, month: m, label: `${m}/2026`, sortOrder: m }))],
    [focData, [{ country: "Libya", skuId: 1, periodId: 9, value: "12.34", received: false, receivedDate: null, receiptDecision: "pending", receiptReviewKey: null }]],
    [arrivalData, []], [planningFgData, []], [clearanceEvents, []], [auditTrail, []],
  ]);
  vi.mocked(dbModule.getDb).mockResolvedValue(connection as any);
});
describe("FOC receipt persistence and bulk confirmation", () => {
  it("defaults to No, persists status/date and records authenticated actor/time without creating arrivals or clearances", async () => {
    const result = await service.updateFocReceipt("Libya", "Administrator", { skuId: 1, periodId: 9, received: true, receivedDate: "2026-11-12" });
    expect(result.changed).toBe(1);
    expect(records.get(focData)![0]).toMatchObject({ received: true, receivedDate: "2026-11-12" });
    expect(records.get(auditTrail)![0]).toMatchObject({ country: "Libya", username: "Administrator", field: "FOC receipt",
      oldValue: '{"received":false,"receivedDate":null}', newValue: '{"received":true,"receivedDate":"2026-11-12"}' });
    expect(records.get(auditTrail)![0].createdAt).toBeInstanceOf(Date);
    expect(records.get(clearanceEvents)).toEqual([]); expect(records.get(arrivalData)).toEqual([]);
  });
  it("changing only date preserves the current received state; clearing date falls back to plan month", async () => {
    records.get(focData)![0].received = true;
    await service.updateFocReceipt("Libya", "Admin", { skuId: 1, periodId: 9, receivedDate: "2026-10-07" });
    expect(records.get(focData)![0].received).toBe(true);
    await service.updateFocReceipt("Libya", "Admin", { skuId: 1, periodId: 9, receivedDate: null });
    expect(records.get(focData)![0]).toMatchObject({ received: true, receivedDate: null });
  });
  it("bulk preview lists changes/skipped not-set without mutation and commit accepts the exact token even with transport country field", async () => {
    const p = await service.previewFocReceipts("Libya", { country: "Libya", skuId: 1, received: true } as any);
    expect(p.changes).toHaveLength(1); expect(p.skippedNotSet).toBe(3);
    expect(records.get(focData)![0].received).toBe(false);
    expect(records.get(auditTrail)).toEqual([]);
    await service.commitFocReceipts("Libya", "Admin", { skuId: 1, received: true }, p.token);
    expect(records.get(focData)![0].received).toBe(true);
    expect(JSON.parse(records.get(auditTrail)![0].details).bulk).toBe(true);
  });
  it("refuses stale preview after quantity, receipt, date or inbound evidence changes, atomically", async () => {
    for (const change of [
      () => { records.get(focData)![0].value = "99"; },
      () => { records.get(focData)![0].received = true; },
      () => { records.get(focData)![0].receivedDate = "2026-10-01"; },
      () => { records.get(clearanceEvents)!.push({ country: "Libya", skuId: 1, clearedQty: "12.34", clearedDate: "2026-09-20" }); },
    ]) {
      const cell = records.get(focData)![0]; Object.assign(cell, { value: "12.34", received: false, receivedDate: null });
      records.set(clearanceEvents, []);
      const p = await service.previewFocReceipts("Libya", { periodId: 9, received: true });
      change();
      await expect(service.commitFocReceipts("Libya", "Admin", { periodId: 9, received: true }, p.token)).rejects.toMatchObject({ code: "CONFLICT" });
      expect(records.get(auditTrail)).toEqual([]);
    }
  });
  it("stores a received duplicate but withholds the additive receipt until explicit review, and audits the decision", async () => {
    records.set(clearanceEvents, [{ country: "Libya", skuId: 1, clearedQty: "12.34", clearedDate: "2026-09-20" }]);
    const result = await service.updateFocReceipt("Libya", "Admin", { skuId: 1, periodId: 9, received: true });
    expect(result.warnings).toHaveLength(1);
    const ds = await service.loadFocReceiptData("Libya");
    const { evaluateFocReceipts } = await import("../shared/performance/focReceipts");
    const e = evaluateFocReceipts(ds)[0]; expect(e.added).toBe(0);
    await service.reviewFocReceipt("Libya", "Admin", { skuId: 1, periodId: 9, decision: "separate", reviewKey: e.reviewKey });
    expect(evaluateFocReceipts(await service.loadFocReceiptData("Libya"))[0].added).toBe(12.34);
    expect(records.get(auditTrail)!.at(-1)).toMatchObject({ username: "Admin", field: "FOC duplicate receipt review", newValue: "separate" });
  });
  it("rejects stale review evidence and cannot claim an uncounted weekly arrival is already in stock", async () => {
    records.get(focData)![0].received = true;
    records.set(arrivalData, [{ skuId: 1, periodId: 9, week1: "12.34" }]);
    const { evaluateFocReceipts } = await import("../shared/performance/focReceipts");
    const e = evaluateFocReceipts(await service.loadFocReceiptData("Libya"))[0];
    await expect(service.reviewFocReceipt("Libya", "Admin", { skuId: 1, periodId: 9, decision: "separate", reviewKey: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(service.reviewFocReceipt("Libya", "Admin", { skuId: 1, periodId: 9, decision: "included", reviewKey: e.reviewKey })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(records.get(auditTrail)).toEqual([]);
  });
  it("rejects foreign/inactive SKU IDs, foreign month IDs, nonexistent date buckets and unset quantity", async () => {
    for (const input of [
      { skuId: 99, periodId: 9, received: true }, { skuId: 1, periodId: 99, received: true },
      { skuId: 1, periodId: 9, receivedDate: "2027-01-01" }, { skuId: 1, periodId: 10, received: true },
    ]) await expect(service.updateFocReceipt("Libya", "Admin", input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(service.updateFocReceipt("Syria", "Admin", { skuId: 1, periodId: 9, received: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    records.get(skus)![0].isActive = false;
    await expect(service.updateFocReceipt("Libya", "Admin", { skuId: 1, periodId: 9, received: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(records.get(auditTrail)).toEqual([]);
  });
});
