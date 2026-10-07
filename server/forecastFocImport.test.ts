import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { skus, periods, focData, forecastData, shipmentData, arrivalData, planningFgData, clearanceEvents, auditTrail, ssofVersions } from "../drizzle/schema";
import { evaluateFocReceipts } from "../shared/performance/focReceipts";
import { buildForecastFocSheet } from "./forecastFocWorkbook";
vi.mock("./db", async original => ({ ...await original<typeof import("./db")>(),
  getDb: vi.fn(), getSkusForCountry: vi.fn(), getPeriodsForCountry: vi.fn() }));
vi.mock("./analysis/countryPerformance", () => ({ invalidateCountryPerformanceCache: vi.fn() }));
const dbModule = await import("./db");
const { invalidateCountryPerformanceCache } = await import("./analysis/countryPerformance");
const { applyForecastFocImport } = await import("./forecastFocImport");
const { importForecastSheet } = await import("./excelImport");
const { loadFocReceiptData } = await import("./focReceiptService");

let records: Map<unknown, any[]>, failFoc: boolean;
const dialect = new PgDialect();
function matches(row: any, where: any) {
  if (!where) return true;
  const q = dialect.sqlToQuery(where);
  return [...q.sql.matchAll(/\."([^"]+)" = \$(\d+)/g)].every(m => {
    const value = row[m[1]] ?? (m[1] === "country" ? records.get(skus)!.find(s => s.id === row.skuId)?.country : undefined);
    return value === q.params[Number(m[2]) - 1];
  });
}
class Query {
  table: unknown; condition: any; wrap: boolean;
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
class Insert {
  target: any; patch: any; constructor(private table: unknown, private row: any) {}
  onConflictDoUpdate({ target, set }: any) { this.target = target; this.patch = set; return this; }
  async commit() {
    if (failFoc && this.table === focData) throw new Error("simulated FOC write failure");
    const rows = records.get(this.table)!;
    const old = this.target && rows.find(r => this.target.every((c: any) => r[c.name] === this.row[c.name]));
    if (old) Object.assign(old, this.patch);
    else rows.push({ id: rows.length + 1, ...this.row });
    return [{ id: rows.length }];
  }
  returning() { return this.commit(); }
  then(resolve: any, reject: any) { return this.commit().then(resolve, reject); }
}
const connection = {
  select: (s?: any) => new Query(s),
  insert: (table: unknown) => ({ values: (row: any) => new Insert(table, row) }),
  execute: async () => ({ rows: [{ snapshot: {
    forecast: structuredClone(records.get(forecastData)), foc: structuredClone(records.get(focData)),
    shipment: structuredClone(records.get(shipmentData)),
  } }] }),
  transaction: async (fn: (tx: any) => Promise<any>) => {
    const tables = [...records.keys()], snapshot = tables.map(t => structuredClone(records.get(t)));
    try { return await fn(connection); }
    catch (e) { tables.forEach((t, i) => records.set(t, snapshot[i]!)); throw e; }
  },
};
beforeEach(() => {
  vi.clearAllMocks(); failFoc = false;
  records = new Map<unknown, any[]>([
    [skus, [
      { id: 1, country: "Libya", isActive: true, name: "Mint", weight: "50g", packagingType: "New", sortOrder: 1 },
      { id: 2, country: "Syria", isActive: true, name: "Mint", weight: "50g", packagingType: "New", sortOrder: 1 },
    ]],
    [periods, [
      { id: 9, country: "Libya", year: 2026, month: 9, label: "Sep 26", sortOrder: 1 },
      { id: 10, country: "Libya", year: 2026, month: 10, label: "Oct 26", sortOrder: 2 },
      { id: 19, country: "Syria", year: 2026, month: 9, label: "Sep 26", sortOrder: 1 },
    ]],
    [focData, [{ country: "Libya", skuId: 1, periodId: 9, value: "12.34", received: false, receiptDecision: "pending", receiptReviewKey: null }]],
    [forecastData, [{ skuId: 1, periodId: 9, value: "100.00" }, { skuId: 2, periodId: 19, value: "500.00" }]],
    [shipmentData, [{ skuId: 1, periodId: 9, week1: "0", week2: "100.00", week3: "0", week4: "0" }]],
    [arrivalData, []], [planningFgData, []], [clearanceEvents, []], [auditTrail, []], [ssofVersions, []],
  ]);
  vi.mocked(dbModule.getDb).mockResolvedValue(connection as any);
  vi.mocked(dbModule.getSkusForCountry).mockImplementation(async c => records.get(skus)!.filter(s => s.country === c));
  vi.mocked(dbModule.getPeriodsForCountry).mockImplementation(async c => records.get(periods)!.filter(p => p.country === c));
});
it("keeps recorded source lines and mixed receipt states when a spreadsheet adjusts the monthly total", async () => {
  const cell = records.get(focData)![0];
  cell.value = "30.00";
  cell.lines = [{ id: "received", quantityMC: 10, received: true, source: "Recorded FOC", accType: "Export", salesManager: "A" },
    { id: "planned", quantityMC: 20, received: false, source: "Recorded FOC", accType: "Domestic", salesManager: "B" }];
  await applyForecastFocImport("Libya", "Admin", [], [{ skuId: 1, periodId: 9, value: "15.00", received: false }]);
  expect(records.get(focData)![0].lines).toEqual([
    expect.objectContaining({ id: "received", quantityMC: 10, received: true, salesManager: "A" }),
    expect.objectContaining({ id: "planned", quantityMC: 5, originalQuantityMC: 20, received: false, salesManager: "B" }),
  ]);
});
const paid = (value = "100.00") => [{ skuId: 1, periodId: 9, value }];
const free = (patch = {}) => [{ skuId: 1, periodId: 9, value: "12.34", received: false, ...patch }];

describe("atomic paired forecast / FOC import", () => {
  it("rejects legacy paired workbooks on Forecast Production without changing any saved data", async () => {
    const ds = await loadFocReceiptData("Libya");
    const wb = new ExcelJS.Workbook();
    buildForecastFocSheet(wb, { ...ds, forecast: records.get(forecastData)! }, true, "Tons");
    await expect(importForecastSheet(Buffer.from(await wb.xlsx.writeBuffer()), "Libya", "Trusted admin"))
      .rejects.toThrow("FOC is recorded only on FOC Record");
    expect(records.get(shipmentData)![0].week2).toBe("100.00");
    expect(records.get(focData)).toHaveLength(1);
    expect(records.get(ssofVersions)).toEqual([]); expect(records.get(auditTrail)).toEqual([]);
    expect(records.get(forecastData)![1]).toMatchObject({ skuId: 2, periodId: 19, value: "500.00" });
  });
  it("saves one rollback version and separately audits paid and FOC changes with the trusted actor and country", async () => {
    const result = await applyForecastFocImport("Libya", "Trusted admin", paid("200.00"), free({ value: "25.00", received: true }));
    expect(result.updated).toBe(2); expect(result.versionId).toBe(1);
    const versions = records.get(ssofVersions)!;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ savedBy: "Trusted admin", country: "Libya" });
    expect(versions[0].snapshotData.forecast[0].value).toBe("100.00");
    expect(versions[0].snapshotData.foc[0].received).toBe(false);
    expect(records.get(focData)![0]).toMatchObject({ value: "25.00", received: true });
    expect(records.get(forecastData)![0].value).toBe("200.00");
    expect(records.get(shipmentData)![0]).toMatchObject({ week1: "200.00", week2: "0" });
    expect(records.get(auditTrail)!.map(r => r.sheet)).toEqual(["Forecast", "FOC"]);
    expect(records.get(auditTrail)!.every(r => r.country === "Libya" && r.username === "Trusted admin")).toBe(true);
    expect(records.get(arrivalData)).toEqual([]); expect(records.get(clearanceEvents)).toEqual([]);
    expect(invalidateCountryPerformanceCache).toHaveBeenCalledWith("Libya");
  });
  it("rolls paid, production, version and audit changes back if the FOC write fails", async () => {
    failFoc = true;
    await expect(applyForecastFocImport("Libya", "Admin", paid("200.00"), free({ value: "25.00" }))).rejects.toThrow("simulated FOC");
    expect(records.get(forecastData)![0].value).toBe("100.00");
    expect(records.get(shipmentData)![0].week2).toBe("100.00");
    expect(records.get(focData)![0].value).toBe("12.34");
    expect(records.get(auditTrail)).toEqual([]); expect(records.get(ssofVersions)).toEqual([]);
    expect(invalidateCountryPerformanceCache).not.toHaveBeenCalled();
  });
  it("respects the saved paid-forecast target week when an imported quantity changes", async () => {
    records.get(forecastData)![0].targetWeek = "week3";
    await applyForecastFocImport("Libya", "Admin", paid("200.00"), free());
    expect(records.get(shipmentData)![0]).toMatchObject({ week1: "0", week2: "0", week3: "200.00", week4: "0" });
    expect(records.get(forecastData)![0].targetWeek).toBe("week3");
  });
  it("holds received duplicates out of stock and does not accept a forged approval from Excel", async () => {
    records.set(clearanceEvents, [{ country: "Libya", skuId: 1, periodId: 9, clearedQty: "12.34", clearedDate: "2026-09-20" }]);
    const result = await applyForecastFocImport("Libya", "Admin", paid(), free({ received: true, receiptDecision: "separate", receiptReviewKey: "forged" }));
    expect(result.warnings).toHaveLength(1);
    expect(records.get(focData)![0]).toMatchObject({ received: true, receiptDecision: "pending", receiptReviewKey: null });
    const entry = evaluateFocReceipts(await loadFocReceiptData("Libya"))[0];
    expect(entry.needsReview).toBe(true); expect(entry.added).toBe(0);
  });
  it("preserves reviewed receipt history when turning Received back to No", async () => {
    Object.assign(records.get(focData)![0], { received: true, receiptDecision: "separate", receiptReviewKey: "previous review evidence" });
    await applyForecastFocImport("Libya", "Admin", paid(), free());
    expect(records.get(focData)![0]).toMatchObject({ received: false, receiptDecision: "separate", receiptReviewKey: "previous review evidence" });
    expect(evaluateFocReceipts(await loadFocReceiptData("Libya"))[0].added).toBe(0);
  });
  it("rejects a foreign SKU/month and invalid receipt decision without any changes", async () => {
    await expect(applyForecastFocImport("Libya", "Admin", [{ skuId: 2, periodId: 19, value: "999" }], free())).rejects.toThrow("inactive or foreign");
    await expect(applyForecastFocImport("Libya", "Admin", paid("200.00"), free({ receiptDecision: "invalid" }))).rejects.toThrow("Invalid duplicate decision");
    expect(records.get(forecastData)![0].value).toBe("100.00");
    expect(records.get(auditTrail)).toEqual([]); expect(records.get(ssofVersions)).toEqual([]);
  });
});
