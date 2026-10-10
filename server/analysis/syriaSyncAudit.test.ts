import { describe, expect, it } from "vitest";
import { buildSyriaSyncAudit, type AuditDataset } from "./syriaSyncAudit";
import type { Feed } from "../wsTracker";

function fixture() {
  const ds: AuditDataset = {
    country: "Syria", now: new Date("2026-10-10"),
    skus: [{ id: 1, name: "Double Apple", weight: "50g", packagingType: "Old" },
      { id: 2, name: "Mint", weight: "50g", packagingType: "New" }],
    periods: [{ id: 1, year: 2025, month: 12, sortOrder: 1 },
      { id: 2, year: 2026, month: 2, sortOrder: 2 }, { id: 3, year: 2026, month: 10, sortOrder: 3 }],
    planningFg: [], ims: [{ skuId: 1, periodId: 3, value: "25320" }], arrival: [],
    forecast: [{ skuId: 1, periodId: 1, value: "14500" }],
    clearanceEvents: [{ skuId: 1, periodId: 1, clearedDate: "2026-02-06", clearedQty: "27128", country: "Syria" }],
    foc: [{ skuId: 1, periodId: 1, country: "Syria", value: "3334", received: true }],
  };
  const p = { flavour: "Red", format: "50g" };
  const f: Feed = { country: "Syria", unit: "MC", generatedAt: "2026-10-10",
    period: { from: "2026-02", to: "2026-10", firstMovement: "", lastMovement: "" },
    products: [{ ...p, trackerProducts: [] }], ims: [{ ...p, month: "2026-10", qty: 25320 }],
    arrivals: [{ ...p, month: "2026-02", qty: 27128 }], arrivalMovements: [{ ...p, date: "2026-02-06", qty: 27128 }],
    totals: { ims: 25320, arrivals: 27128 } };
  return { ds, f };
}
describe("complete Syria sync audit", () => {
  it("explains the 3334 MC example exactly without claiming net movements are a published warehouse balance", () => {
    const { ds, f } = fixture();
    const r = buildSyriaSyncAudit(ds, f, { 1: 1808 });
    expect(r.summary[0]).toMatchObject({ ssofClosing: 1808, trackerWarehouseStock: 1808,
      legacyReceivedFocAddition: 3334, obsoleteFormulaClosing: 5142, warehouseDifference: 0, unexplainedMovementDifference: 0 });
    expect(r.summary[1]).toMatchObject({ trackerWarehouseStock: null, trackerProducts: "Not carried by tracker" });
    expect(r.monthly.every(r => r.trackerWarehouseStock === null)).toBe(true);
  });
  it("shows every monthly contribution, stale values, adjustments, and forecast-marked actuals without overlapping causes", () => {
    const { ds, f } = fixture();
    ds.planningFg = [{ skuId: 1, periodId: 1, openingStock: "20", adjustments: "3" },
      { skuId: 1, periodId: 2, openingStock: "999" }];
    ds.ims.push({ skuId: 1, periodId: 1, value: "5" });
    ds.ims[0].value = "25310"; ds.ims[0].source = "forecast";
    ds.arrival = [{ skuId: 1, periodId: 1, week1: "8" }];
    const r = buildSyriaSyncAudit(ds, f);
    expect(r.summary[0].stockMinusMovementNet).toBe(28);
    expect(r.causes.filter(c => c.skuId === 1).reduce((a, c) => a + c.mc, 0)).toBe(28);
    expect(r.diagnostics.map(d => d.kind)).toContain("Forecast-marked IMS inside tracker coverage");
    expect(r.diagnostics.map(d => d.kind)).toContain("Later opening ignored by carried stock chain");
    expect(r.summary[0].unexplainedMovementDifference).toBe(0);
  });
  it("lists overflow deliveries, deliveries before production, dormant SKUs and missing mappings", () => {
    const { ds, f } = fixture();
    ds.forecast[0].periodId = 3;
    ds.foc = [];
    ds.skus[1].isActive = false;
    f.arrivalMovements.push({ flavour: "Red", format: "50g", date: "2026-03-01", qty: 10 });
    f.products.push({ flavour: "Unknown", format: "50g", trackerProducts: [] });
    const r = buildSyriaSyncAudit(ds, f);
    expect(r.summary[0]).toMatchObject({ overflow: 10, beforeProduction: 27138 });
    expect(r.unmapped).toEqual([{ product: "Unknown 50g", ims: 0, inbound: 0 }]);
    expect(r.summary[1].active).toBe(false);
  });
  it("rejects a different country instead of applying Syria rules", () => {
    const { ds, f } = fixture();
    expect(() => buildSyriaSyncAudit({ ...ds, country: "Libya" }, f)).toThrow("Syria only");
  });
});
