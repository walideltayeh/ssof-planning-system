import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSyriaReconciliation, finishBreakdown, loadSyriaReconciliation, type ReconciliationFeed } from "./syriaReconciliation";
import { getSkusForCountry } from "../db";
import { fetchFeed } from "../wsTracker";
import type { PerformanceDataset } from "./countryPerformance.helpers";
import type { SyriaReconciliation } from "../../shared/performance/syriaReconciliation";

vi.mock("../db", () => ({ getSkusForCountry: vi.fn() }));
vi.mock("../wsTracker", async importOriginal => ({
  ...await importOriginal<typeof import("../wsTracker")>(),
  fetchFeed: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

function fixture() {
  const ds: PerformanceDataset = {
    country: "Syria", now: new Date("2026-10-06T10:00:00Z"),
    skus: [{ id: 1, name: "Double Apple", weight: "50g", category: "Core", packagingType: "New", isActive: true }],
    periods: [{ id: 10, year: 2026, month: 1, label: "Jan 2026", sortOrder: 1 }, { id: 11, year: 2026, month: 2, label: "Feb 2026", sortOrder: 2 }],
    planningFg: [{ skuId: 1, periodId: 10, openingStock: "0", adjustments: "0", arrivals: "0" }],
    ims: [{ skuId: 1, periodId: 10, value: "80" }],
    shipment: [{ skuId: 1, periodId: 10, week1: "100", week2: "0", week3: "0", week4: "0" }],
    clearanceEvents: [{ skuId: 1, periodId: 10, clearedQty: "50", clearedDate: "2026-01-05" }],
    forecast: [], actualProduction: [], arrival: [], expiryRows: [],
  };
  const product = { flavour: "Two Apples Black", format: "50g" };
  const f: ReconciliationFeed = {
    country: "Syria", unit: "MC", generatedAt: "2026-02-28T12:00:00Z",
    period: { from: "2026-01", to: "2026-02", firstMovement: "2026-01-05", lastMovement: "2026-01-05" },
    products: [{ ...product, trackerProducts: ["Apple"] }],
    ims: [{ ...product, month: "2026-01", qty: 80 }],
    arrivals: [{ ...product, month: "2026-01", qty: 100 }],
    arrivalMovements: [{ ...product, date: "2026-01-05", qty: 100 }],
    totals: { ims: 80, arrivals: 100 },
    warehouseBalances: [{ ...product, month: "2026-02", openingMonth: "2026-01", openingStock: 0, closingStock: 20 }],
  };
  return { ds, f };
}
const run = (ds: PerformanceDataset, f: ReconciliationFeed) => buildSyriaReconciliation(ds, f, { from: "2026-01", to: "2026-02" });
const getLine = (r: SyriaReconciliation, id: "ims" | "arrivals" | "warehouse") => r.lines.find(l => l.id === id)!;
const cause = (r: SyriaReconciliation, id: "ims" | "arrivals" | "warehouse", c: string) => getLine(r, id).breakdown.find(b => b.cause === c)!;
const reconciles = (r: SyriaReconciliation) => {
  for (const l of r.lines) if (l.difference !== null) {
    expect(Number(l.breakdown.reduce((a, b) => a + (b.mc ?? 0), 0).toFixed(2))).toBe(l.difference);
    for (const b of l.breakdown) if (b.mc !== null) expect(Number(b.details.reduce((a, d) => a + d.mc, 0).toFixed(2))).toBe(b.mc);
  }
};

describe("Syria read-only tracker reconciliation", () => {
  it("explains a complete missing-clearance stock gap and keeps negative SSOF stock", () => {
    const { ds, f } = fixture(), before = structuredClone(ds);
    const r = run(ds, f);
    expect(getLine(r, "ims").ties).toBe(true);
    expect(getLine(r, "arrivals").difference).toBe(50);
    expect(getLine(r, "warehouse")).toMatchObject({ tracker: 20, ssof: -30, difference: 50, ties: false });
    expect(cause(r, "warehouse", "uncleared").mc).toBe(50);
    expect(cause(r, "warehouse", "unexplained").mc).toBe(0);
    expect(r.conclusion).toContain("50 MC of tracker-confirmed deliveries without clearance");
    reconciles(r);
    expect(ds).toEqual(before);
  });

  it("does not count un-cleared production as physically arrived without tracker evidence", () => {
    const { ds, f } = fixture();
    f.arrivals[0].qty = 50; f.arrivalMovements[0].qty = 50;
    f.warehouseBalances![0].closingStock = -30;
    const r = run(ds, f);
    expect(r.pendingProduction[0].mc).toBe(50);
    expect(cause(r, "warehouse", "uncleared").mc).toBe(0);
    expect(getLine(r, "arrivals").ties).toBe(true);
    expect(getLine(r, "warehouse").ties).toBe(true);
    reconciles(r);
  });

  it("handles a month-shift once, with the opposite opening effect instead of double-counting", () => {
    const { ds, f } = fixture();
    ds.clearanceEvents[0].clearedQty = "100";
    ds.ims[0].periodId = 11;
    f.ims[0].month = "2026-02"; f.arrivals[0].month = "2026-02"; f.arrivalMovements[0].date = "2026-02-05";
    f.warehouseBalances![0].openingMonth = "2026-02";
    const r = buildSyriaReconciliation(ds, f, { from: "2026-02", to: "2026-02" });
    expect(cause(r, "arrivals", "dated").mc).toBe(100);
    expect(cause(r, "warehouse", "opening").mc).toBe(-100);
    expect(getLine(r, "warehouse").difference).toBe(0);
    expect(cause(r, "arrivals", "dated").details[0]).toMatchObject({ trackerMonth: "2026-02", ssofMonth: "2026-01" });
    reconciles(r);
  });

  it("leaves ambiguous repeated delivery quantities unexplained rather than inventing dates", () => {
    const { ds, f } = fixture();
    ds.clearanceEvents[0].clearedDate = "2026-02-05";
    f.arrivalMovements = [{ ...f.arrivalMovements[0], qty: 50 }, { ...f.arrivalMovements[0], date: "2026-01-06", qty: 50 }];
    const r = buildSyriaReconciliation(ds, f, { from: "2026-01", to: "2026-01" });
    expect(cause(r, "arrivals", "dated").mc).toBe(0);
    reconciles(r);
  });

  it("accounts for planner adjustments with the right sign", () => {
    const { ds, f } = fixture();
    ds.planningFg[0].adjustments = "10.25";
    const r = run(ds, f);
    expect(getLine(r, "warehouse").difference).toBe(39.75);
    expect(cause(r, "warehouse", "adjustments").mc).toBe(-10.25);
    reconciles(r);
  });

  it("does not treat a later opening entry as an applied balance", () => {
    const { ds, f } = fixture();
    ds.planningFg.push({ skuId: 1, periodId: 11, openingStock: "9500", adjustments: "0", arrivals: "0" });
    const r = run(ds, f);
    expect(r.chainStart).toBe("2026-01");
    expect(r.ignoredOpeningEntries[0]).toMatchObject({ month: "2026-02", mc: 9500 });
    expect(getLine(r, "warehouse").ssof).toBe(-30);
    reconciles(r);
  });

  it("separates a mapped IMS tie from additional SSOF-only sell-out", () => {
    const { ds, f } = fixture();
    ds.skus.push({ id: 3, name: "Grape and Mint", weight: "1kg", category: "Core", packagingType: "New" });
    ds.ims.push({ skuId: 3, periodId: 10, value: "50" });
    const r = run(ds, f);
    expect(r.mappedIms).toEqual({ tracker: 80, ssof: 80, ties: true });
    expect(getLine(r, "ims").difference).toBe(-50);
    expect(cause(r, "ims", "ssofOnly").mc).toBe(-50);
    expect(cause(r, "warehouse", "ssofOnly").mc).toBe(50);
    expect(r.conclusion).toContain("for mapped products only");
    reconciles(r);
  });

  it("does not infer missing warehouse stock or opening from matched movement totals", () => {
    const { ds, f } = fixture();
    delete f.warehouseBalances;
    const r = run(ds, f);
    expect(getLine(r, "warehouse")).toMatchObject({ tracker: null, difference: null, ties: null });
    expect(cause(r, "warehouse", "opening").mc).toBeNull();
    expect(cause(r, "warehouse", "unexplained").mc).toBeNull();
    expect(getLine(r, "warehouse").missing).toHaveLength(2);
    reconciles(r);
  });

  it("keeps a known stock gap unexplained if its opening balance is absent", () => {
    const { ds, f } = fixture();
    delete f.warehouseBalances![0].openingStock;
    f.warehouseBalances![0].closingStock = 27;
    const r = run(ds, f);
    expect(getLine(r, "warehouse").difference).toBe(57);
    expect(cause(r, "warehouse", "opening").mc).toBeNull();
    expect(cause(r, "warehouse", "unexplained").mc).toBe(7);
    reconciles(r);
  });

  it("assigns unmapped products, inactive SKUs and missing months exactly once", () => {
    const { ds, f } = fixture();
    ds.skus.push({ id: 2, name: "Grape", weight: "50g", category: "Core", isActive: false });
    f.arrivals.push(
      { flavour: "Unknown", format: "50g", month: "2026-01", qty: 13 },
      { flavour: "Grape", format: "50g", month: "2026-01", qty: 7 },
    );
    ds.periods[1].month = 3;
    f.period.to = "2026-03";
    f.arrivals.push({ ...f.arrivals[0], month: "2026-02", qty: 9 });
    const r = buildSyriaReconciliation(ds, f, { from: "2026-01", to: "2026-03" });
    expect(cause(r, "arrivals", "unmapped").mc).toBe(13);
    expect(cause(r, "arrivals", "inactive").mc).toBe(7);
    expect(cause(r, "arrivals", "outside").mc).toBe(9);
    expect(getLine(r, "arrivals").difference).toBe(79);
    reconciles(r);
  });

  it("rejects cross-country use and wrong units rather than changing another country", () => {
    const { ds, f } = fixture();
    expect(() => run({ ...ds, country: "Libya" }, f)).toThrow("Syria only");
    expect(() => run(ds, { ...f, country: "Lebanon" })).toThrow("Syria only");
    expect(() => run(ds, { ...f, unit: "KG" })).toThrow("mastercases");
  });

  it("rejects invalid published balances instead of treating them as zero", () => {
    const { ds, f } = fixture();
    f.warehouseBalances![0].closingStock = Number.NaN;
    expect(() => run(ds, f)).toThrow("invalid");
  });

  it("reads Syria's inactive master SKUs for comparison without adding them to SSOF totals", async () => {
    const { ds, f } = fixture();
    const allSkus = [...ds.skus, { id: 2, name: "Grape", weight: "50g", category: "Core", isActive: false }];
    vi.mocked(getSkusForCountry).mockResolvedValue(allSkus as unknown as Awaited<ReturnType<typeof getSkusForCountry>>);
    f.arrivals.push({ flavour: "Grape", format: "50g", month: "2026-01", qty: 7 });
    vi.mocked(fetchFeed).mockResolvedValue(f);
    const r = await loadSyriaReconciliation(ds, { from: { year: 2026, month: 1 }, to: { year: 2026, month: 2 } });
    expect(getSkusForCountry).toHaveBeenCalledWith("Syria", true);
    expect(r.status).toBe("available");
    expect(cause(r, "arrivals", "inactive").mc).toBe(7);
    expect(getLine(r, "warehouse").ssof).toBe(-30);
    reconciles(r);
  });

  it("turns feed failure into an explicit unavailable comparison, not a cached or zero stock balance", async () => {
    const { ds } = fixture();
    vi.mocked(getSkusForCountry).mockResolvedValue([]);
    vi.mocked(fetchFeed).mockRejectedValue(new Error("HTTP failure"));
    const r = await loadSyriaReconciliation(ds, { from: { year: 2026, month: 1 }, to: { year: 2026, month: 2 } });
    expect(r).toMatchObject({ status: "unavailable", generatedAt: null, lines: [], warning: true });
    expect(r.error).toContain("could not be read");
  });

  it("reports no overlapping dates rather than showing a false zero / tie", () => {
    const { ds, f } = fixture();
    expect(buildSyriaReconciliation(ds, f, { from: "2025-01", to: "2025-12" })).toMatchObject({ status: "unavailable", lines: [], warning: true });
  });

  it("balances positive and negative unexplained residuals to two decimals", () => {
    for (const difference of [13.29, -27.51, 0]) {
      const rows = finishBreakdown(difference, [
        { cause: "adjustments", label: "Adjustments", mc: -10.25, note: "", details: [] },
        { cause: "unexplained", label: "Unexplained", mc: 0, note: "", details: [] },
      ]);
      expect(Number(rows.reduce((sum, r) => sum + (r.mc ?? 0), 0).toFixed(2))).toBe(difference);
    }
  });
});
