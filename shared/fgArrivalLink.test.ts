import { describe, expect, it } from "vitest";
import { fgProductionMap } from "./arrivalQuantities";
import { buildStockLedger, type StockDataset } from "./performance/stock";
import { evaluateFocReceipts } from "./performance/focReceipts";

function fixture(): StockDataset {
  return {
    country: "Syria", now: new Date("2026-10-09T00:00:00Z"),
    skus: [{ id: 1, country: "Syria" }],
    periods: [
      { id: 9, year: 2026, month: 9, sortOrder: 9, country: "Syria" },
      { id: 10, year: 2026, month: 10, sortOrder: 10, country: "Syria" },
    ],
    forecast: [{ skuId: 1, periodId: 9, value: "1000" }],
    shipment: [{ skuId: 1, periodId: 9, week1: "1000", week2: "0", week3: "0", week4: "0" }],
    actualProduction: [], planningFg: [{ skuId: 1, periodId: 9, openingStock: "50" }],
    ims: [{ skuId: 1, periodId: 10, value: "100" }],
    arrival: [], clearanceEvents: [],
    foc: [{ country: "Syria", skuId: 1, periodId: 9, value: "100", received: false }],
  };
}

describe("Production / FOC / Arrival → FG links", () => {
  it("keeps the exact 100 + 10 example out of stock until the full 110 is cleared", () => {
    const ds = fixture();
    ds.forecast[0].value = "100"; ds.shipment![0].week1 = "100"; ds.foc![0].value = "10";
    ds.planningFg[0].openingStock = "0"; ds.ims = [];
    expect(fgProductionMap(ds.country, ds.forecast, [], ds.foc, ds.shipment).get("1-9")).toBe(100);
    ds.foc![0].received = true;
    expect(fgProductionMap(ds.country, ds.forecast, [], ds.foc, ds.shipment).get("1-9")).toBe(110);
    expect(buildStockLedger(ds).bySku.get(1)!.get(9)!.closing).toBe(0);
    ds.clearanceEvents = [{ country: "Syria", skuId: 1, periodId: 9, clearedQty: "100", clearedDate: "2026-10-02" }];
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.closing).toBe(100);
    ds.clearanceEvents[0].clearedQty = "110";
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.closing).toBe(110);
    ds.foc![0].received = false;
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.closing).toBe(110);
  });
  it("shows the combined physical production while unreceived quantities do not enter stock or cover", () => {
    const ds = fixture();
    expect(fgProductionMap(ds.country, ds.forecast, ds.actualProduction, ds.foc).get("1-9")).toBe(1000);
    const balance = buildStockLedger(ds).bySku.get(1)!;
    expect(balance.get(9)).toMatchObject({ opening: 50, arrivals: 0, closing: 50 });
    expect(balance.get(10)).toMatchObject({ opening: 50, arrivals: 0, ims: 100, closing: -50 });
    expect(evaluateFocReceipts(ds)[0].awaiting).toBe(100);
  });
  it("Received FOC joins the quantity to clear but only paid clearance enters stock", () => {
    const ds = fixture();
    ds.foc![0].received = true;
    ds.clearanceEvents = [{ country: "Syria", skuId: 1, periodId: 9, clearedQty: "1000", clearedDate: "2026-10-02" }];
    const balance = buildStockLedger(ds).bySku.get(1)!;
    expect(fgProductionMap(ds.country, ds.forecast, [], ds.foc, ds.shipment).get("1-9")).toBe(1100);
    expect(balance.get(9)).toMatchObject({ arrivals: 0, closing: 50 });
    expect(balance.get(10)).toMatchObject({ opening: 50, arrivals: 1000, closing: 950 });
  });
  it("counts a combined Production + FOC clearance once, not again through the Received switch", () => {
    const ds = fixture();
    ds.foc![0].received = true;
    ds.clearanceEvents = [{ country: "Syria", skuId: 1, periodId: 9, clearedQty: "1100", clearedDate: "2026-10-02" }];
    const receipt = evaluateFocReceipts(ds)[0];
    expect(receipt.needsReview).toBe(false);
    expect(receipt.matches).toEqual([]);
    expect(receipt.added).toBe(0);
    const balance = buildStockLedger(ds).bySku.get(1)!;
    expect(balance.get(9)!.arrivals).toBe(0);
    expect(balance.get(10)).toMatchObject({ opening: 50, arrivals: 1100, closing: 1050 });
    ds.foc![0].receiptDecision = "included";
    ds.foc![0].receiptReviewKey = receipt.reviewKey;
    expect(evaluateFocReceipts(ds)[0]).toMatchObject({ needsReview: false, added: 0 });
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.closing).toBe(1050);
  });
  it("recalculates FG after a clearance is edited or deleted, without writing stock snapshots", () => {
    const ds = fixture();
    ds.clearanceEvents = [{ country: "Syria", skuId: 1, periodId: 9, clearedQty: "600", clearedDate: "2026-10-02" }];
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.closing).toBe(550);
    ds.clearanceEvents[0].clearedQty = "1100";
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.closing).toBe(1050);
    ds.clearanceEvents = [];
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.closing).toBe(-50);
    expect(ds.planningFg[0].openingStock).toBe("50");
  });
  it("uses positive manual production overrides and retains FOC-only production", () => {
    const ds = fixture();
    ds.foc![0].received = true;
    ds.actualProduction = [{ skuId: 1, periodId: 9, value: "800" }];
    expect(fgProductionMap(ds.country, ds.forecast, ds.actualProduction, ds.foc).get("1-9")).toBe(900);
    ds.actualProduction[0].value = "0";
    expect(fgProductionMap(ds.country, ds.forecast, ds.actualProduction, ds.foc).get("1-9")).toBe(1100);
    ds.forecast = [];
    expect(fgProductionMap(ds.country, ds.forecast, [], ds.foc).get("1-9")).toBe(100);
  });
  it("uses entered production weeks before forecast in Syria FG, matching Arrival", () => {
    const ds = fixture();
    ds.foc![0].received = true;
    ds.shipment![0].week1 = "800";
    expect(fgProductionMap(ds.country, ds.forecast, [], ds.foc, ds.shipment).get("1-9")).toBe(900);
    ds.actualProduction = [{ skuId: 1, periodId: 9, value: "700" }];
    expect(fgProductionMap(ds.country, ds.forecast, ds.actualProduction, ds.foc, ds.shipment).get("1-9")).toBe(800);
    expect(fgProductionMap("Libya", ds.forecast, [], [{ ...ds.foc![0], country: "Libya" }], ds.shipment).get("1-9")).toBe(1000);
  });
  it("protects partial combined clearances and rejects foreign-country evidence", () => {
    const ds = fixture();
    ds.foc![0].received = true;
    ds.clearanceEvents = [{ country: "Syria", skuId: 1, periodId: 9, clearedQty: "1040", clearedDate: "2026-10-02" }];
    expect(evaluateFocReceipts(ds)[0]).toMatchObject({ needsReview: false, added: 0 });
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.arrivals).toBe(1040);
    ds.clearanceEvents[0].country = "Libya";
    expect(evaluateFocReceipts(ds)[0]).toMatchObject({ needsReview: false, added: 0 });
    expect(buildStockLedger(ds).bySku.get(1)!.get(10)!.arrivals).toBe(0);
  });
});
