import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildStockLedger } from "../../shared/performance/stock";
import { evaluateFocReceipts, focReceiptAdditions, summarizeFocReceipts, validReceiptDate } from "../../shared/performance/focReceipts";
import { buildPack } from "./countryPerformance";
import { buildPerformanceWorkbook } from "./countryPerformanceExcel";
import type { PerformanceDataset } from "./countryPerformance.helpers";

function fixture(country: "Libya" | "Syria" = "Libya"): PerformanceDataset {
  return { country, now: new Date("2026-10-07T12:00:00Z"),
    skus: [{ id: 1, name: "Mint", weight: "50g", category: "Core", packagingType: "New", isActive: true, isExcludedFromTotal: false }],
    periods: Array.from({ length: 12 }, (_, i) => ({ id: i + 1, year: 2026, month: i + 1, label: `${i + 1}/2026`, sortOrder: i + 1 })),
    forecast: Array.from({ length: 12 }, (_, i) => ({ skuId: 1, periodId: i + 1, value: "100" })),
    ims: [{ skuId: 1, periodId: 9, value: "10", source: "manual" }], shipment: [], arrival: [], actualProduction: [],
    clearanceEvents: [], planningFg: [{ skuId: 1, periodId: 1, openingStock: "1000", adjustments: "0", arrivals: "0" }],
    foc: [{ skuId: 1, periodId: 9, value: "12.34", received: false, receivedDate: null }] };
}
const request = { country: "Libya" as const, preset: "custom" as const, from: "2026-09", to: "2026-12", compare: "plan" as const };
const ledger = (ds: PerformanceDataset, includeFoc = true) => buildStockLedger({ ...ds, includeFoc });

describe("Confirmed FOC receipt stock rules", () => {
  it.each(["Libya", "Syria"] as const)("unreceived %s FOC changes no arrival, closing, cover, stock total or forward stock", country => {
    const ds = fixture(country);
    const a = ledger(ds), b = ledger({ ...ds, foc: [] });
    expect(a).toEqual(b);
    const off = buildPack(ds, { ...request, country, includeFoc: false }, null);
    const on = buildPack(ds, { ...request, country, includeFoc: true }, null);
    expect(on.stockSituation).toEqual(off.stockSituation);
    expect(on.flow.waterfall.stock).toEqual(off.flow.waterfall.stock);
    expect(on.inventory).toEqual(off.inventory);
    expect(on.forward.inputs).toEqual(off.forward.inputs);
    expect(on.forward.total).toEqual(off.forward.total);
    expect(on.forward.byWeight).toEqual(off.forward.byWeight);
    expect(on.forward.gaps).toEqual(off.forward.gaps);
    expect(on.runningRate.closingStock).toBe(off.runningRate.closingStock);
    expect(on.runningRate.coverWeeks).toBe(off.runningRate.coverWeeks);
    expect(on.headline.closingStock).toBe(off.headline.closingStock);
    expect(on.headline.weeksOfCover).toBe(off.headline.weeksOfCover);
    expect(summarizeFocReceipts(ds).months[8]).toMatchObject({ planned: 12.34, received: 0, awaiting: 12.34 });
  });
  it.each(["Libya", "Syria"] as const)("Yes adds exactly 12.34 MC and No reverses it exactly in %s", country => {
    const ds = fixture(country), before = ledger(ds);
    ds.foc![0].received = true;
    const after = ledger(ds);
    for (let month = 1; month <= 12; month++) {
      const delta = month >= 9 ? 12.34 : 0;
      expect(after.bySku.get(1)!.get(month)!.closing - before.bySku.get(1)!.get(month)!.closing).toBeCloseTo(delta, 8);
      expect(after.totals.get(month)! - before.totals.get(month)!).toBeCloseTo(delta, 8);
      expect(after.bySku.get(1)!.get(month)!.arrivals - before.bySku.get(1)!.get(month)!.arrivals).toBe(month === 9 ? 12.34 : 0);
    }
    expect(ledger(ds, false)).toEqual(before);
    ds.foc![0].received = false;
    expect(ledger(ds)).toEqual(before);
  });
  it("receipt date moves the additive receipt, including across years; blank returns to plan month", () => {
    const ds = fixture();
    ds.periods.push({ id: 13, year: 2027, month: 1, label: "1/2027", sortOrder: 13 });
    const c = ds.foc![0]; c.received = true; c.receivedDate = "2026-11-19";
    let l = ledger(ds);
    expect(l.bySku.get(1)!.get(9)!.arrivals).toBe(0);
    expect(l.bySku.get(1)!.get(11)!.arrivals).toBe(12.34);
    c.receivedDate = "2027-01-01"; l = ledger(ds);
    expect(l.bySku.get(1)!.get(11)!.arrivals).toBe(0);
    expect(l.bySku.get(1)!.get(13)!.arrivals).toBe(12.34);
    c.receivedDate = null; l = ledger(ds);
    expect(l.bySku.get(1)!.get(9)!.arrivals).toBe(12.34);
    expect(l.bySku.get(1)!.get(13)!.arrivals).toBe(0);
  });
  it("No remains completely inert even with a date, prior review and matching arrivals", () => {
    const ds = fixture(); ds.foc![0].receivedDate = "2026-11-12";
    ds.clearanceEvents.push({ skuId: 1, periodId: 1, clearedQty: "12.34", clearedDate: "2026-11-12", country: "Libya" });
    ds.foc![0].receiptDecision = "separate"; ds.foc![0].receiptReviewKey = "stale";
    expect(ledger(ds)).toEqual(ledger({ ...ds, foc: [] }));
  });
  it.each(["Libya", "Syria"] as const)("detects similar recorded/clearance inbound, blocks addition, and warns in %s confidence", country => {
    const ds = fixture(country); ds.foc![0].received = true;
    ds.clearanceEvents.push({ skuId: 1, periodId: 1, clearedQty: "12.34", clearedDate: "2026-09-20", country });
    const e = evaluateFocReceipts(ds)[0];
    expect(e).toMatchObject({ quantity: 12.34, added: 0, needsReview: true });
    expect(ledger(ds)).toEqual(ledger({ ...ds, foc: [] }));
    const pack = buildPack(ds, { ...request, country }, null);
    const warning = pack.confidence.issues.find(e => e.title === "Possible duplicate FOC receipt")!;
    expect(warning.detail).toContain("Mint 50g"); expect(warning.detail).toContain("12.34 MC");
    expect(warning.detail).toContain("Not added");
    expect(pack.foc!.receipts!.total.reviewPending).toBe(12.34);
  });
  it("checks recorded weekly arrivals and partial clearances, but ignores another SKU/month/country", () => {
    const ds = fixture("Syria"); ds.foc![0].received = true;
    ds.arrival = [{ skuId: 1, periodId: 9, week1: "12.34", week2: "100", week3: "0", week4: "0" }];
    expect(evaluateFocReceipts(ds)[0].needsReview).toBe(true);
    ds.arrival = []; ds.clearanceEvents = [
      { skuId: 1, periodId: 1, clearedQty: "6.17", clearedDate: "2026-09-02", country: "Syria" },
      { skuId: 1, periodId: 2, clearedQty: "6.17", clearedDate: "2026-09-03", country: "Syria" },
    ];
    expect(evaluateFocReceipts(ds)[0].matches.some(m => m.source === "Monthly clearance total")).toBe(true);
    ds.clearanceEvents = [
      { skuId: 2, periodId: 9, clearedQty: "12.34", clearedDate: "2026-09-03", country: "Syria" },
      { skuId: 1, periodId: 8, clearedQty: "12.34", clearedDate: "2026-08-03", country: "Syria" },
      { skuId: 1, periodId: 9, clearedQty: "12.34", clearedDate: "2026-09-03", country: "Libya" },
    ];
    expect(evaluateFocReceipts(ds)[0].added).toBe(12.34);
  });
  it.each(["included", "separate"])("requires explicit %s review; survives tracker IDs being recreated and reblocks changed quantities", decision => {
    const ds = fixture("Syria"); ds.foc![0].received = true;
    ds.clearanceEvents = [{ skuId: 1, periodId: 8, clearedQty: "12.34", clearedDate: "2026-09-05", country: "Syria" }];
    const e = evaluateFocReceipts(ds)[0]; ds.foc![0].receiptDecision = decision; ds.foc![0].receiptReviewKey = e.reviewKey;
    expect(evaluateFocReceipts(ds)[0].added).toBe(decision === "separate" ? 12.34 : 0);
    const before = ledger(ds);
    ds.clearanceEvents = ds.clearanceEvents.map(r => ({ ...r, id: 987, periodId: 7 }));
    expect(ledger(ds)).toEqual(before);
    ds.clearanceEvents[0].clearedQty = "20"; // no longer within similarity range: prior decision still must be reviewed
    expect(evaluateFocReceipts(ds)[0]).toMatchObject({ added: 0, needsReview: true });
    ds.foc![0].receivedDate = "2026-11-01";
    expect(evaluateFocReceipts(ds)[0].needsReview).toBe(true);
  });
  it("an entirely separate received FOC layer survives tracker clearing/replacing all clearance rows", () => {
    const ds = fixture("Syria"); ds.foc![0].received = true;
    expect(focReceiptAdditions(ds).get("1-9")).toBe(12.34);
    ds.clearanceEvents = [{ skuId: 1, periodId: 9, clearedQty: "700", clearedDate: "2026-09-20", country: "Syria" }];
    expect(focReceiptAdditions(ds).get("1-9")).toBe(12.34);
    ds.clearanceEvents = [];
    expect(focReceiptAdditions(ds).get("1-9")).toBe(12.34);
  });
  it("rechecks after a new tracker inbound creates a duplicate; never adds automatically on top", () => {
    const ds = fixture("Syria"); ds.foc![0].received = true;
    expect(evaluateFocReceipts(ds)[0].added).toBe(12.34);
    ds.clearanceEvents = [{ skuId: 1, periodId: 9, clearedQty: "12.35", clearedDate: "2026-09-20", country: "Syria" }];
    expect(evaluateFocReceipts(ds)[0]).toMatchObject({ added: 0, needsReview: true });
  });
  it("warns when two received FOC cells land in the same month at similar sizes", () => {
    const ds = fixture(); ds.foc![0].received = true;
    ds.foc!.push({ skuId: 1, periodId: 10, value: "12.34", received: true, receivedDate: "2026-09-30" });
    expect(evaluateFocReceipts(ds).every(e => e.needsReview && e.added === 0)).toBe(true);
  });
  it("groups landed receipts by calendar date, awaiting by plan month, and cohort percent cannot exceed 100", () => {
    const ds = fixture(); ds.foc![0].received = true; ds.foc![0].receivedDate = "2026-11-12";
    const s = summarizeFocReceipts(ds);
    expect(s.months[8]).toMatchObject({ planned: 12.34, received: 0, receivedForPlan: 12.34, awaiting: 0, receivedPercent: 100 });
    expect(s.months[10]).toMatchObject({ received: 12.34 });
    expect(s.skus[0]).toMatchObject({ received: 12.34, awaiting: 0 });
    const off = summarizeFocReceipts(ds, false);
    expect(off.total).toMatchObject({ received: 0, excluded: 12.34, awaiting: 0 });
    expect(s.total.missing).toBe(11);
    expect(s.total.receivedPercent).toBeNull();
  });
  it("unknown/invalid date buckets fail closed; legacy quantity-only rows default No; inactive/foreign never enter stock", () => {
    const ds = fixture(); ds.foc![0].received = true; ds.foc![0].receivedDate = "2040-12-01";
    expect(evaluateFocReceipts(ds)[0]).toMatchObject({ added: 0, needsReview: true });
    ds.foc![0].receivedDate = "2026-02-30";
    expect(evaluateFocReceipts(ds)[0].added).toBe(0);
    ds.foc = [{ skuId: 1, periodId: 9, value: "12.34" }];
    expect(evaluateFocReceipts(ds)[0]).toMatchObject({ received: false, added: 0 });
    ds.foc[0].received = true; ds.foc[0].country = "Syria";
    expect(evaluateFocReceipts(ds)).toEqual([]);
    delete ds.foc[0].country; ds.skus[0].isActive = false;
    expect(evaluateFocReceipts(ds)).toEqual([]);
  });
  it.each(["Lebanon", "KSA"] as const)("does not add FOC stock in %s", country => {
    const ds = { ...fixture(), country }; ds.foc![0].received = true;
    expect(evaluateFocReceipts(ds)).toEqual([]);
    expect(ledger(ds)).toEqual(ledger({ ...ds, foc: [] }));
  });
  it("validates real ISO dates without timezone coercion", () => {
    expect(validReceiptDate("2028-02-29")).toBe(true);
    for (const d of ["2026-02-29", "2026-02-30", "2026-09-31", "2026-13-01", "2026-01-01T00:00:00Z", "not a date"])
      expect(validReceiptDate(d)).toBe(false);
  });
  it("keeps commercial/IMS values unchanged while every analysis stock headline and arrival gains the exact receipt", () => {
    const ds = fixture(); const before = buildPack(ds, request, null);
    ds.foc![0].received = true;
    const after = buildPack(ds, request, null);
    expect(after.demand).toEqual(before.demand); expect(after.commercial).toEqual(before.commercial);
    expect(after.stockSituation.totals.arrival - before.stockSituation.totals.arrival).toBe(12.34);
    expect(after.stockSituation.totals.remainingStock - before.stockSituation.totals.remainingStock).toBeCloseTo(12.34, 8);
    expect(after.headline.closingStock - before.headline.closingStock).toBeCloseTo(12.34, 8);
    expect(after.runningRate.closingStock - before.runningRate.closingStock).toBeCloseTo(12.34, 8);
    expect(after.runningRate.coverWeeks!).toBeGreaterThan(before.runningRate.coverWeeks!);
    ds.foc![0].received = false;
    expect(buildPack(ds, request, null).stockSituation).toEqual(before.stockSituation);
  });
  it("exports receipt statuses/date/destination/received/awaiting/review in the selected basis", async () => {
    const ds = fixture(); ds.foc![0].received = true; ds.foc![0].receivedDate = "2026-11-12";
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildPerformanceWorkbook(buildPack(ds, request, null)) as any);
    const ws = wb.worksheets.find(s => s.name.endsWith("FOC"))!;
    const values: unknown[] = []; ws.eachRow(r => r.eachCell(c => values.push(c.value)));
    expect(values).toContain("Yes"); expect(values).toContain("2026-11-12"); expect(values).toContain(12.34);
    expect(values).toContain("11/2026");
  });
});
