import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { skus, periods, focData, forecastData, imsData, arrivalData, planningFgData, clearanceEvents, auditTrail, ssofVersions } from "../drizzle/schema";
import { blankFocDraft } from "../shared/focEntry";
import { restoreFocOnlySnapshot } from "./focSnapshot";
import { loadFocReceiptData } from "./focReceiptService";
import { evaluateFocReceipts } from "../shared/performance/focReceipts";
import { buildStockLedger } from "../shared/performance/stock";
import type { CellChange } from "./focEntryService";
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(), getDb: vi.fn() }));
const dbModule = await import("./db");
const service = await import("./focEntryService");
const dialect = new PgDialect();
let records: Map<unknown, any[]>, failPeriod: number | null;
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
  orderBy() { return this; } innerJoin() { return this; } for() { return this; }
  then(resolve: any, reject: any) { return Promise.resolve((records.get(this.table) ?? []).filter(r => matches(r, this.condition)).map(r => this.wrap ? { row: structuredClone(r) } : structuredClone(r))).then(resolve, reject); }
}
const connection = {
  select: (s?: any) => new Query(s),
  delete: (table: unknown) => ({ where: async (where: any) => { records.set(table, records.get(table)!.filter(r => !matches(r, where))); } }),
  insert: (table: unknown) => ({ values: (input: any) => {
    const rows = Array.isArray(input) ? input : [input];
    let executed = false;
    const run = (patch?: any) => {
      if (executed) return rows; executed = true;
      for (const row of rows) {
        if (table === focData && row.periodId === failPeriod) throw new Error("Simulated failed cell write");
        if (![focData, auditTrail, ssofVersions].includes(table as any)) throw new Error("FOC must not write stock, forecast or arrivals");
        const target = records.get(table)!;
        const old = patch && target.find(r => r.country === row.country && r.skuId === row.skuId && r.periodId === row.periodId);
        if (old) Object.assign(old, structuredClone(patch));
        else target.push({ id: target.length + 1, updatedAt: new Date(), ...structuredClone(row) });
      }
      return records.get(table)!;
    };
    return { onConflictDoUpdate: async (o: any) => run(o.set), returning: async () => run().slice(-1),
      then: (resolve: any, reject: any) => { try { return Promise.resolve(run()).then(resolve, reject); } catch (e) { return Promise.reject(e).then(resolve, reject); } } };
  } }),
  transaction: async (fn: (tx: any) => Promise<any>) => {
    const snapshot = [...records.entries()].map(([t, r]) => [t, structuredClone(r)] as const);
    try { return await fn(connection); } catch (e) { records = new Map(snapshot); throw e; }
  },
};
const draft = (quantityMC = "10", date = "Jun-26", received = true) => ({ ...blankFocDraft(), date, flavor: "Mint", weight: "50gr", packaging: "New Packaging", quantityMC, received, accType: "Export", salesManager: "Manager A" });
beforeEach(() => {
  failPeriod = null;
  records = new Map<unknown, any[]>([
    [skus, [{ id: 1, country: "Libya", name: "Mint", weight: "50g", packagingType: "New", isActive: true, sortOrder: 1 },
      { id: 2, country: "Syria", name: "Mint", weight: "50g", packagingType: "New", isActive: true }]],
    [periods, [6, 7, 8].map(m => ({ id: m, year: 2026, month: m, label: `${["Jun", "Jul", "Aug"][m - 6]} 26`, country: "Libya", sortOrder: m }))],
    [focData, []], [forecastData, []], [imsData, []], [arrivalData, []], [clearanceEvents, []], [auditTrail, []], [ssofVersions, []],
    [planningFgData, [{ skuId: 1, periodId: 6, openingStock: "100", adjustments: "0" }]],
  ]);
  vi.mocked(dbModule.getDb).mockResolvedValue(connection as any);
});
describe("past FOC preview, atomic commit, audit and rollback", () => {
  it.each(["Libya", "Syria"] as const)("moves a whole SKU's quantities, receipt states and original lines, and transfers arrivals and closing stock in %s", async country => {
    records.set(skus, [
      { id: 1, country, name: "Mint", weight: "50g", packagingType: "New", isActive: true },
      { id: 3, country, name: "Mint", weight: "50g", packagingType: "Old", isActive: true },
    ]);
    records.get(periods)!.forEach(p => { p.country = country; });
    records.set(planningFgData, [{ skuId: 1, periodId: 6, openingStock: "100" }, { skuId: 3, periodId: 6, openingStock: "200" }]);
    const sourceLine = { id: "source-june", quantityMC: 10, received: true, source: "Recorded FOC",
      date: "Jun-26", flavor: "Mint", weight: "50gr", packaging: "Old Packaging", accType: "Export",
      salesManager: "Original manager", actor: "Original creator", recordedAt: "2026-06-01T10:00:00Z" };
    const julyLine = { ...sourceLine, id: "source-july", quantityMC: 20, received: false, date: "Jul-26" };
    const targetLine = { ...sourceLine, id: "target-june", quantityMC: 5, received: false };
    const original = [
      { country, skuId: 1, periodId: 6, value: "10.00", received: true, lines: [sourceLine] },
      { country, skuId: 1, periodId: 7, value: "20.00", received: false, lines: [julyLine] },
      { country, skuId: 3, periodId: 6, value: "5.00", received: false, lines: [targetLine] },
    ];
    records.set(focData, structuredClone(original));
    const move = { move: { sourceSkuId: 1, targetSkuId: 3 } };
    const preview = await service.previewFocEntry(country, move, true);
    expect(preview.move).toMatchObject({ sourceTotalBefore: 30, sourceTotalAfter: 0, targetTotalBefore: 5, targetTotalAfter: 35 });
    expect(preview.move!.months[0]).toMatchObject({ targetBefore: 5, targetAfter: 15, resultLineCount: 2, receivedMC: 10 });
    expect(preview.impact.find(r => r.skuId === 1 && r.periodId === 6)).toMatchObject({ before: 110, after: 100, beforeArrivals: 10, afterArrivals: 0 });
    expect(preview.impact.find(r => r.skuId === 3 && r.periodId === 6)).toMatchObject({ before: 200, after: 210, beforeArrivals: 0, afterArrivals: 10 });
    await service.commitFocEntry(country, move, true, "Moving admin", preview.token);
    expect(records.get(focData)!.filter(c => c.skuId === 1)).toEqual([]);
    expect(records.get(focData)!.find(c => c.skuId === 3 && c.periodId === 6)).toMatchObject({ value: "15.00", received: false, lines: [targetLine, sourceLine] });
    expect(records.get(focData)!.find(c => c.skuId === 3 && c.periodId === 7)).toMatchObject({ value: "20.00", received: false, lines: [julyLine] });
    const ds = await loadFocReceiptData(country);
    const ledger = buildStockLedger({ ...ds, ims: [], forecast: [], includeFoc: true, now: new Date(2026, 9, 7) });
    expect([...ledger.bySku.get(1)!.values()].map(r => [r.arrivals, r.closing])).toEqual([[0, 100], [0, 100], [0, 100]]);
    expect([...ledger.bySku.get(3)!.values()].map(r => [r.arrivals, r.closing])).toEqual([[10, 210], [0, 210], [0, 210]]);
    expect(records.get(auditTrail)!.every(a => a.field === "FOC SKU reassignment" && a.details.includes("Mint · 50g · New") && a.details.includes("Mint · 50g · Old"))).toBe(true);
    const version = records.get(ssofVersions)![0];
    expect(version.snapshotData.foc).toEqual(original);
    await restoreFocOnlySnapshot(connection as any, version.snapshotData, country);
    expect(records.get(focData)!.find(c => c.skuId === 1 && c.periodId === 6)?.lines).toEqual([sourceLine]);
    expect(records.get(clearanceEvents)).toEqual([]);
  });
  it("moves only selected months, validates scope, and rejects a stale move confirmation atomically", async () => {
    records.get(skus)!.push({ id: 3, country: "Libya", name: "Mint", weight: "50g", packagingType: "Old", isActive: true });
    records.set(focData, [6, 7].map(periodId => ({ country: "Libya", skuId: 1, periodId, value: "10.00", received: true, lines: [] })));
    await expect(service.previewFocEntry("Libya", { move: { sourceSkuId: 1, targetSkuId: 2 } }, true)).rejects.toThrow("active SKUs");
    await expect(service.previewFocEntry("Libya", { move: { sourceSkuId: 1, targetSkuId: 3, periodIds: [999] } }, true)).rejects.toThrow("valid month");
    const operation = { move: { sourceSkuId: 1, targetSkuId: 3, periodIds: [7] } };
    const preview = await service.previewFocEntry("Libya", operation, true);
    records.get(focData)![1].value = "20.00";
    await expect(service.commitFocEntry("Libya", operation, true, "Admin", preview.token)).rejects.toThrow("changed since preview");
    expect(records.get(ssofVersions)).toEqual([]);
    const fresh = await service.previewFocEntry("Libya", operation, true);
    await service.commitFocEntry("Libya", operation, true, "Admin", fresh.token);
    expect(records.get(focData)!.find(c => c.skuId === 1 && c.periodId === 6)?.value).toBe("10.00");
    expect(records.get(focData)!.some(c => c.skuId === 1 && c.periodId === 7)).toBe(false);
    expect(records.get(focData)!.find(c => c.skuId === 3 && c.periodId === 7)).toMatchObject({ value: "20.00", received: true });
  });
  it.each(["Libya", "Syria"] as const)("reverses operational arrivals and every closing stock exactly for %s, independently of tracker rebuilds", async country => {
    const skuId = country === "Libya" ? 1 : 2;
    records.get(periods)!.forEach(p => { p.country = country; });
    records.set(planningFgData, [{ skuId, periodId: 6, openingStock: "100", adjustments: "0" }]);
    const apply = async (cell: CellChange) => {
      const operation = { cell };
      const preview = await service.previewFocEntry(country, operation, true);
      await service.commitFocEntry(country, operation, true, "Country admin", preview.token);
      return preview;
    };
    await apply({ skuId, periodId: 6, value: 30 });
    const read = async () => {
      const ds = await loadFocReceiptData(country);
      return { entries: evaluateFocReceipts(ds, true), stock: buildStockLedger({
        ...ds, ims: [], forecast: [], includeFoc: true, now: new Date(2026, 9, 7),
      }).bySku.get(skuId)! };
    };
    let actual = await read();
    expect(actual.entries.reduce((sum, e) => sum + e.added, 0)).toBe(0);
    expect([...actual.stock.values()].map(v => v.closing)).toEqual([100, 100, 100]);
    const received = await apply({ skuId, periodId: 6, received: true });
    expect(received.impact.map(p => [p.before, p.after])).toEqual([[100, 130], [100, 130], [100, 130]]);
    actual = await read();
    expect(actual.entries.reduce((sum, e) => sum + e.added, 0)).toBe(30);
    expect(actual.stock.get(6)).toMatchObject({ arrivals: 30, closing: 130 });
    const persisted = structuredClone(records.get(focData));
    // Tracker rebuild owns production/clearance inputs, never the independent FOC record.
    records.set(arrivalData, []);
    records.set(clearanceEvents, []);
    actual = await read();
    expect(records.get(focData)).toEqual(persisted);
    expect([...actual.stock.values()].map(v => v.closing)).toEqual([130, 130, 130]);
    const reversed = await apply({ skuId, periodId: 6, received: false });
    expect(reversed.impact.map(p => [p.before, p.after])).toEqual([[130, 100], [130, 100], [130, 100]]);
    actual = await read();
    expect(actual.entries.reduce((sum, e) => sum + e.added, 0)).toBe(0);
    expect([...actual.stock.values()].map(v => [v.arrivals, v.closing])).toEqual([[0, 100], [0, 100], [0, 100]]);
    expect(records.get(ssofVersions)).toHaveLength(3);
    expect(records.get(auditTrail)).toHaveLength(3);
    expect(records.get(ssofVersions)![2].snapshotData.foc[0].received).toBe(true);
    expect(records.get(clearanceEvents)).toEqual([]);
    expect(records.get(forecastData)).toEqual([]);
  });
  it("audits and backs up individual edits, line deletions and whole-cell deletion without touching siblings or another country", async () => {
    const operation = { lines: [draft("10"), draft("20", "Jun-26", false)] };
    const preview = await service.previewFocEntry("Libya", operation, true);
    await service.commitFocEntry("Libya", operation, true, "Creator", preview.token);
    const [first, second] = structuredClone(records.get(focData)![0].lines);
    records.get(focData)!.push({ country: "Syria", skuId: 2, periodId: 6, value: "50.00", received: true, lines: [] });
    const foreign = structuredClone(records.get(focData)![1]);
    const apply = async (cell: CellChange) => {
      const op = { cell };
      const p = await service.previewFocEntry("Libya", op, true);
      await service.commitFocEntry("Libya", op, true, "Editor", p.token);
    };
    await apply({ skuId: 1, periodId: 6, lineId: first.id, value: 15 });
    expect(records.get(focData)![0]).toMatchObject({ value: "35.00", lines: [
      { ...first, quantityMC: 15, originalQuantityMC: 10 }, second,
    ] });
    await apply({ skuId: 1, periodId: 6, lineId: second.id, remove: true });
    expect(records.get(focData)![0]).toMatchObject({ value: "15.00", received: true });
    expect(records.get(focData)![0].lines).toHaveLength(1);
    await apply({ skuId: 1, periodId: 6, remove: true });
    expect(records.get(focData)).toEqual([foreign]);
    expect(records.get(ssofVersions)).toHaveLength(4);
    expect(records.get(auditTrail)).toHaveLength(4);
    expect(records.get(ssofVersions)![2].snapshotData.foc[0].lines[1]).toEqual(second);
    expect(records.get(ssofVersions)![3].snapshotData.foc[0].value).toBe("15.00");
    expect(records.get(auditTrail)![3]).toMatchObject({ country: "Libya", username: "Editor", sheet: "FOC" });
    expect(JSON.parse(records.get(auditTrail)![3].newValue)).toMatchObject({ value: null, received: false, lines: [] });
  });
  it("rejects conflicting selected-SKU identity instead of silently replacing the original source details", async () => {
    const invalid = { lines: [{ ...draft("10"), skuId: 1, packaging: "Old" }] };
    const invalidPreview = await service.previewFocEntry("Libya", invalid, true);
    expect(invalidPreview.canSave).toBe(false);
    await expect(service.commitFocEntry("Libya", invalid, true, "Admin", invalidPreview.token)).rejects.toThrow("unmatched");
    expect(records.get(focData)).toEqual([]);
    expect(records.get(ssofVersions)).toEqual([]);
    const operation = { lines: [{ ...draft("10"), skuId: 1 },
      { ...draft("20"), skuId: 1 }] };
    const preview = await service.previewFocEntry("Libya", operation, true);
    expect(preview.canSave).toBe(true);
    await service.commitFocEntry("Libya", operation, true, "Admin", preview.token);
    expect(records.get(focData)![0]).toMatchObject({ value: "30.00", lines: [
      expect.objectContaining({ flavor: "Mint", weight: "50gr", packaging: "New Packaging", quantityMC: 10 }),
      expect.objectContaining({ flavor: "Mint", weight: "50gr", packaging: "New Packaging", quantityMC: 20 }),
    ] });
  });
  it("flags an inactive pasted SKU explicitly and never commits it", async () => {
    records.get(skus)![0].isActive = false;
    const operation = { lines: [draft()] };
    const preview = await service.previewFocEntry("Libya", operation, true);
    expect(preview.canSave).toBe(false);
    expect(preview.rows[0].errors).toContain("This SKU is inactive. Select an active SKU for this country.");
    await expect(service.commitFocEntry("Libya", operation, true, "Admin", preview.token)).rejects.toThrow();
    expect(records.get(focData)).toEqual([]);
    expect(records.get(ssofVersions)).toEqual([]);
  });
  it("rejects inactive and foreign selected IDs even with valid active SKU text", async () => {
    records.get(skus)!.push({ ...records.get(skus)![0], id: 3, isActive: false });
    for (const skuId of [2, 3]) {
      const operation = { lines: [{ ...draft(), skuId }] };
      const preview = await service.previewFocEntry("Libya", operation, true);
      expect(preview.canSave).toBe(false);
      await expect(service.commitFocEntry("Libya", operation, true, "Admin", preview.token)).rejects.toThrow();
    }
    expect(records.get(focData)).toEqual([]);
  });
  it("previews past-month carry-forward without writing, sums lines and snapshots everything before commit", async () => {
    const operation = { lines: [draft("10"), draft("20", "Jun-26", false)] };
    const preview = await service.previewFocEntry("Libya", operation, true);
    expect(preview.canSave).toBe(true); expect(records.get(focData)).toEqual([]); expect(records.get(auditTrail)).toEqual([]);
    expect(preview.impact.map(r => [r.month, r.before, r.after])).toEqual([["Jun 26", 100, 110], ["Jul 26", 100, 110], ["Aug 26", 100, 110]]);
    const committed = await service.commitFocEntry("Libya", operation, true, "Actual administrator", preview.token);
    const saved = records.get(focData)![0];
    expect(saved).toMatchObject({ country: "Libya", skuId: 1, periodId: 6, value: "30.00", received: false });
    expect(saved.lines).toHaveLength(2);
    expect(saved.lines[0]).toMatchObject({ quantityMC: 10, received: true, actor: "Actual administrator", accType: "Export", salesManager: "Manager A",
      date: "Jun-26", flavor: "Mint", weight: "50gr", packaging: "New Packaging" });
    expect(records.get(ssofVersions)![0].snapshotData).toEqual({ focOnly: true, country: "Libya", foc: [] });
    expect(JSON.parse(records.get(auditTrail)![0].details)).toMatchObject({ versionId: committed.versionId, impact: preview.impact });
  });
  it("refuses the entire batch for unknown SKU or period and never silently drops lines", async () => {
    for (const invalid of [{ ...draft(), flavor: "Unknown" }, draft("20", "Jun-25")]) {
      const operation = { lines: [draft(), invalid] }, preview = await service.previewFocEntry("Libya", operation, true);
      expect(preview.rows).toHaveLength(2); expect(preview.canSave).toBe(false);
      await expect(service.commitFocEntry("Libya", operation, true, "Admin", preview.token)).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(records.get(focData)).toEqual([]); expect(records.get(ssofVersions)).toEqual([]);
    }
  });
  it("requires a new preview when stock inputs change and rolls all writes and backups back on a failure", async () => {
    const operation = { lines: [draft(), draft("10", "Jul-26")] };
    const preview = await service.previewFocEntry("Libya", operation, true);
    records.get(planningFgData)![0].openingStock = "200";
    await expect(service.commitFocEntry("Libya", operation, true, "Admin", preview.token)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(records.get(ssofVersions)).toEqual([]);
    const fresh = await service.previewFocEntry("Libya", operation, true); failPeriod = 7;
    await expect(service.commitFocEntry("Libya", operation, true, "Admin", fresh.token)).rejects.toThrow("Simulated");
    expect(records.get(focData)).toEqual([]); expect(records.get(auditTrail)).toEqual([]); expect(records.get(ssofVersions)).toEqual([]);
  });
  it("previews duplicate withheld stock and lets only the confirmed matching line be resolved", async () => {
    records.get(clearanceEvents)!.push({ country: "Libya", skuId: 1, periodId: 6, clearedQty: "10", clearedDate: "2026-06-10" });
    const operation = { lines: [draft(), draft("20")] };
    const preview = await service.previewFocEntry("Libya", operation, true);
    expect(preview.warnings).toHaveLength(1); expect(preview.impact[0]).toMatchObject({ before: 110, after: 130 });
    await service.commitFocEntry("Libya", operation, true, "Admin", preview.token);
    const current = await service.previewFocEntry("Libya", { cell: { skuId: 1, periodId: 6, received: true } }, true);
    const warning = current.warnings[0], cell = { skuId: 1, periodId: 6, lineId: warning.lineId, decision: "included" as const, reviewKey: warning.reviewKey };
    const review = await service.previewFocEntry("Libya", { cell }, true);
    await service.commitFocEntry("Libya", { cell }, true, "Admin", review.token);
    expect((await service.previewFocEntry("Libya", { cell: { skuId: 1, periodId: 6, received: true } }, true)).warnings).toEqual([]);
  });
  it("supports past cell edits with a valid confirmation and received reversals, while blocking foreign scope", async () => {
    const cell = { skuId: 1, periodId: 6, value: 12.34 };
    const preview = await service.previewFocEntry("Libya", { cell }, true);
    await service.commitFocEntry("Libya", { cell }, true, "Admin", preview.token);
    const receipt = { skuId: 1, periodId: 6, received: true }, p = await service.previewFocEntry("Libya", { cell: receipt }, true);
    expect(p.impact[0]).toMatchObject({ before: 100, after: 112.34 });
    await service.commitFocEntry("Libya", { cell: receipt }, true, "Admin", p.token);
    expect((await service.previewFocEntry("Libya", { cell: { ...receipt, received: false } }, true)).impact[0]).toMatchObject({ before: 112.34, after: 100 });
    await expect(service.previewFocEntry("Libya", { cell: { skuId: 2, periodId: 6, value: 10 } }, true)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("restores only this country's FOC ledger, leaving other countries, forecast and stock inputs intact", async () => {
    const original = { id: 1, country: "Libya" as const, skuId: 1, periodId: 6, value: "5", received: false, lines: [], updatedAt: new Date() };
    const expectedOriginal = structuredClone(original);
    records.get(focData)!.push(original);
    const operation = { lines: [draft()] }, p = await service.previewFocEntry("Libya", operation, true);
    await service.commitFocEntry("Libya", operation, true, "Admin", p.token);
    const foreign = { country: "Syria", skuId: 2, periodId: 60, value: "40" }; records.get(focData)!.push(foreign);
    const planning = structuredClone(records.get(planningFgData));
    await restoreFocOnlySnapshot(connection as any, records.get(ssofVersions)![0].snapshotData, "Libya");
    expect(records.get(focData)).toContainEqual(expectedOriginal); expect(records.get(focData)).toContainEqual(foreign);
    expect(records.get(planningFgData)).toEqual(planning);
    await expect(restoreFocOnlySnapshot(connection as any, { country: "Libya", foc: [foreign] } as any, "Libya")).rejects.toThrow("scope");
  });
});
