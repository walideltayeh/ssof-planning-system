import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildStockLedger } from "../../shared/performance/stock";
import { stockUnitFactor } from "../../shared/performance/units";
import type { PerformanceDataset } from "./countryPerformance.helpers";
import { buildPack } from "./countryPerformance";
import { buildPerformanceWorkbook } from "./countryPerformanceExcel";
import { applyPlan, type SyncPlan } from "../wsTracker";
import * as db from "../db";

let ds: PerformanceDataset;
vi.mock("../db", () => ({
  bulkUpsertIms: vi.fn(async (rows: PerformanceDataset["ims"]) => {
    for (const row of rows) ds.ims = [...ds.ims.filter(r => r.skuId !== row.skuId || r.periodId !== row.periodId), row];
  }),
  bulkUpsertArrival: vi.fn(),
  getClearanceEventsForCountry: vi.fn(async () => []),
  deleteClearanceEvent: vi.fn(),
  addClearanceEvent: vi.fn(async (row: PerformanceDataset["clearanceEvents"][number]) => { ds.clearanceEvents.push(row); }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  ds = {
    country: "Syria", now: new Date("2026-10-06T10:00:00Z"),
    skus: [
      { id: 1, name: "Double Apple", weight: "50g", category: "Core" },
      { id: 2, name: "Grape and Mint", weight: "1kg", category: "Core" },
      { id: 3, name: "Excluded", weight: "50g", category: "Core", isExcludedFromTotal: true },
      { id: 4, name: "Inactive", weight: "50g", category: "Core", isActive: false },
    ],
    periods: [
      { id: 10, year: 2026, month: 8, label: "Aug 2026", sortOrder: 1 },
      { id: 11, year: 2026, month: 9, label: "Sep 2026", sortOrder: 2 },
      { id: 12, year: 2026, month: 10, label: "Oct 2026", sortOrder: 3 },
    ],
    planningFg: [
      { skuId: 1, periodId: 10, openingStock: "10", adjustments: "0", arrivals: "0" },
      { skuId: 2, periodId: 10, openingStock: "0", adjustments: "0", arrivals: "0" },
      { skuId: 3, periodId: 10, openingStock: "999999", adjustments: "0", arrivals: "0" },
      { skuId: 4, periodId: 10, openingStock: "999999", adjustments: "0", arrivals: "0" },
    ],
    ims: [{ skuId: 1, periodId: 11, value: "100" }, { skuId: 2, periodId: 11, value: "50" }],
    clearanceEvents: [{ skuId: 1, periodId: 10, clearedDate: "2026-09-05", clearedQty: "300" }],
    arrival: [{ skuId: 1, periodId: 11, week1: "300", week2: "0", week3: "0", week4: "0" }],
    forecast: [], shipment: [], actualProduction: [], expiryRows: [],
  };
});

function reconcile(country = ds.country, anchor = "2026-09") {
  ds.country = country;
  const pack = buildPack(ds, { country, preset: "ytd", anchor, compare: "plan" }, null);
  const ledger = buildStockLedger(ds);
  const closing = ledger.totals.get(pack.meta.window.to.id)!;
  expect(pack.stockSituation.totals.remainingStock).toBe(closing);
  expect(pack.headline.closingStock).toBe(closing);
  expect(pack.inventory.cover.reduce((sum, r) => sum + r.closingStock, 0)).toBe(closing);
  expect(pack.runningRate.closingStock).toBe(closing);
  expect(pack.executive.tiles.find(t => t.key === "closing")?.value).toBe(closing);
  expect(pack.flow.waterfall.stock.find(s => s.key === "closing")?.value).toBe(closing);
  expect(pack.forward.inputs.skus.reduce((sum, s) => sum + s.openingStock, 0)).toBe(closing);
  expect(pack.stockSituation.rows.map(r => r.skuId)).toEqual([1, 2]);
  return pack;
}

describe("one country/period closing-stock ledger", () => {
  it.each(["Lebanon", "Syria", "Libya", "KSA"] as const)("reconciles %s's Stock Situation, Inventory Health and Planning FG", country => {
    const pack = reconcile(country);
    expect(pack.headline.closingStock).toBe(160);
    expect(pack.confidence.issues.find(i => i.title === "Negative closing stock")?.detail).toContain("Grape and Mint 1kg (New): -50 MC");
    expect(pack.stockSituation.rows.find(r => r.skuId === 2)?.remainingStock).toBe(-50);
    reconcile(country, "2026-08"); // Stock is a balance, not a sum of monthly closings.
  });

  it("uses the selected ending balance for cover even when latest sales were earlier", () => {
    ds.planningFg.push({ skuId: 1, periodId: 12, openingStock: "0", adjustments: "25", arrivals: "0" });
    expect(reconcile("Syria", "2026-10").runningRate.closingStock).toBe(185);
  });

  it("reports negative active SKUs even when explicitly excluded from stock totals", () => {
    ds.planningFg.find(r => r.skuId === 3)!.openingStock = "-25";
    const pack = reconcile();
    expect(pack.confidence.issues.find(i => i.title === "Negative closing stock")?.detail).toContain("Excluded 50g (New): -25 MC (excluded from totals)");
    expect(pack.headline.closingStock).toBe(160);
  });

  it("counts every dated clearance, even without a production batch, and rejects other-country events", () => {
    ds.clearanceEvents.push(
      { skuId: 1, periodId: 10, clearedDate: "2026-09-15", clearedQty: "30.25" },
      { skuId: 999, periodId: 10, clearedDate: "2026-09-15", clearedQty: "999999" },
    );
    const mixed = { ...ds, clearanceEvents: [...ds.clearanceEvents, { skuId: 1, clearedDate: "2026-09-15", clearedQty: "999999", country: "Libya" }] };
    expect(buildStockLedger(mixed).totals.get(11)).toBe(190.25);
    expect(reconcile().headline.closingStock).toBe(190.25);
  });

  it("still reconciles after the existing Syria tracker sync without overwriting planner stock", async () => {
    const plannerStock = structuredClone(ds.planningFg);
    ds.clearanceEvents = [];
    const plan = {
      rows: [{ section: "IMS", skuId: 1, periodId: 11, month: "2026-09", next: 70 }],
      clearance: { events: [{ skuId: 1, periodId: 10, date: "2026-09-09", qty: 300 }] },
    } as unknown as SyncPlan;
    await applyPlan(plan);
    expect(db.getClearanceEventsForCountry).toHaveBeenCalledWith("Syria");
    expect(db.addClearanceEvent).toHaveBeenCalledWith(expect.objectContaining({ country: "Syria", skuId: 1 }));
    expect(ds.planningFg).toEqual(plannerStock);
    expect(reconcile().headline.closingStock).toBe(190);
  });

  it.each(["MC", "KG", "Tons"] as const)("exports identical closing totals in %s without changing stored MC values", async unit => {
    const pack = reconcile();
    const buffer = await buildPerformanceWorkbook(pack, { unit });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const stock = wb.worksheets.find(s => s.name.includes("Stock Situation"))!;
    const inventory = wb.worksheets.find(s => s.name.includes("Inventory Health"))!;
    let stockClosing: unknown, inventoryClosing: unknown;
    stock.eachRow(row => { if (row.getCell(1).value === "Total") stockClosing = row.getCell(6).value; });
    inventory.eachRow(row => { if (row.getCell(1).value === `Closing stock (${unit})`) inventoryClosing = row.getCell(2).value; });
    expect(stockClosing).toBe(160 * stockUnitFactor(unit));
    expect(inventoryClosing).toBe(stockClosing);
    expect(pack.headline.closingStock).toBe(160);
  });
});
