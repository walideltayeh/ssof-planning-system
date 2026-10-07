import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { LIBYA_PO, matchLibyaPo } from "../../shared/libyaPurchaseOrder";
import { summarizeFoc } from "../../shared/performance/foc";
import { buildPack } from "./countryPerformance";
import { parsePerformanceExportQuery } from "./countryPerformanceExport";
import { buildPerformanceWorkbook } from "./countryPerformanceExcel";
import { buildSkuSeries, type PerformanceDataset } from "./countryPerformance.helpers";

function fixture(country: PerformanceDataset["country"] = "Libya"): PerformanceDataset {
  const skus = LIBYA_PO.map((s, i) => ({ id: i + 1, name: s.name, weight: s.weight, country, category: "Core", packagingType: "New", isActive: true, priceToWs: "30" }));
  const periods = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, country, year: 2026, month: i + 1, label: `Month ${i + 1}`, sortOrder: i + 1 }));
  return {
    country, skus, periods, now: new Date(2026, 9, 7), shipment: [], actualProduction: [], arrival: [], clearanceEvents: [],
    forecast: skus.flatMap((s, i) => [9, 10, 11, 12].map((p, j) => ({ skuId: s.id, periodId: p, value: String(LIBYA_PO[i].ordered[j]) }))),
    foc: skus.flatMap((s, i) => [9, 10, 11, 12].map((p, j) => ({ skuId: s.id, periodId: p, value: String(LIBYA_PO[i].foc[j]) }))),
    ims: skus.flatMap(s => periods.map(p => ({ skuId: s.id, periodId: p.id, value: p.month <= 10 ? "100" : "0", source: "manual" }))),
    planningFg: skus.map(s => ({ skuId: s.id, periodId: 1, openingStock: "100000", adjustments: "0", arrivals: "0" })),
  };
}
const req = { country: "Libya" as const, preset: "custom" as const, from: "2026-09", to: "2026-12", compare: "plan" as const };

describe("FOC and approved Libya PO", () => {
  it("keeps exact monthly quantities with no KG conversion or penny rebalancing", () => {
    const ds = fixture();
    const summary = summarizeFoc(ds.skus, ds.periods.slice(8), ds.forecast, ds.foc!, true);
    expect(summary.months.map(m => m.ordered)).toEqual([16370, 22488.33, 30821.67, 41820.01]);
    expect(summary.months.map(m => m.foc)).toEqual([1715.38, 2315.31, 3148.45, 4248.44]);
    expect(summary.total).toMatchObject({ ordered: 111500.01, foc: 11427.58, physical: 122927.59, missing: 0 });
  });
  it("missing is not zero, and entered-only subtotals are labelled incomplete", () => {
    const ds = fixture();
    const none = summarizeFoc(ds.skus, ds.periods.slice(8), ds.forecast, [], true);
    expect(none.total).toMatchObject({ foc: null, percent: null, physical: null, enteredFoc: 0, missing: 16 });
    const zero = summarizeFoc([ds.skus[0]], [ds.periods[8]], ds.forecast, [{ skuId: 1, periodId: 9, value: "0" }], true);
    expect(zero.total).toMatchObject({ foc: 0, percent: 0, missing: 0 });
  });
  it("does not aggregate inactive or excluded SKUs, or an unselected month", () => {
    const ds = fixture();
    ds.skus[0].isActive = false; ds.skus[1].isExcludedFromTotal = true;
    const s = summarizeFoc(ds.skus, [ds.periods[8]], ds.forecast, ds.foc!, true);
    expect(s.total).toMatchObject({ ordered: 1096.32, foc: 114.88 });
    expect(s.skus).toHaveLength(2);
  });
  it.each(["Libya", "Syria"] as const)("uses one %s physical plan while preserving IMS, money, actual receipts and stock", country => {
    const ds = fixture(country);
    const off = buildPack(ds, { ...req, country, includeFoc: false }, null);
    const on = buildPack(ds, { ...req, country }, null);
    expect(on.foc!.includeFoc).toBe(true);
    expect(on.flow.waterfall.supply.find(s => s.key === "plan")!.value).toBe(122927.59);
    expect(off.flow.waterfall.supply.find(s => s.key === "plan")!.value).toBe(111500.01);
    expect(on.supply.attainment.reduce((t, m) => t + m.plan, 0)).toBeCloseTo(122927.59, 2);
    expect(on.demand).toEqual(off.demand);
    expect(on.commercial).toEqual(off.commercial);
    expect(on.forecastQuality).toEqual(off.forecastQuality);
    expect(on.flow.waterfall.stock).toEqual(off.flow.waterfall.stock);
    expect(on.flow.pipeline.map(s => s.mc)).toEqual(off.flow.pipeline.map(s => s.mc));
    expect(on.supply.attainment.map(m => m.actual)).toEqual(off.supply.attainment.map(m => m.actual));
    expect(on.stockSituation.totals.remainingStock).toEqual(off.stockSituation.totals.remainingStock);
    expect(ds.forecast[0].value).toBe("2740.79");
  });
  it("keeps unreceived FOC out of forward stock requirements and cover", () => {
    const ds = fixture();
    const off = buildPack(ds, { ...req, preset: "month", anchor: "2026-08", includeFoc: false }, null);
    const on = buildPack(ds, { ...req, preset: "month", anchor: "2026-08", includeFoc: true }, null);
    expect(on.forward.inputs.skus[0].demand[0]).toBeCloseTo(100, 2);
    expect(off.forward.inputs.skus[0].demand[0]).toBeCloseTo(100, 2);
    const before = buildPack(ds, { ...req, preset: "month", anchor: "2026-10", includeFoc: false }, null);
    const after = buildPack(ds, { ...req, preset: "month", anchor: "2026-10", includeFoc: true }, null);
    expect(buildSkuSeries({ ...ds, includeFoc: true })[0].months[9].weeks!)
      .toEqual(buildSkuSeries({ ...ds, includeFoc: false })[0].months[9].weeks!);
    expect(after.demand).toEqual(before.demand);
    ds.ims = [];
    const fallback = buildPack(ds, { ...req, preset: "month", anchor: "2026-08", includeFoc: true }, null);
    expect(fallback.forward.inputs.skus[0].demand[0]).toBeCloseTo(2740.79, 2);
  });
  it.each(["Lebanon", "KSA"] as const)("never applies the FOC layer in %s", country => {
    const ds = fixture(country);
    const a = buildPack(ds, { ...req, country, includeFoc: true }, null);
    const b = buildPack(ds, { ...req, country, includeFoc: false }, null);
    expect(a.foc).toBeUndefined();
    expect(a.supply).toEqual(b.supply);
  });
  it("stops for missing or ambiguous active New-packaging Libya mappings", () => {
    const ds = fixture();
    const ss = ds.skus.map(s => ({ ...s, country: "Libya", packagingType: "New", isActive: true }));
    const ps = ds.periods.map(p => ({ ...p, country: "Libya" }));
    expect(matchLibyaPo(ss, ps)).toHaveLength(16);
    expect(() => matchLibyaPo(ss.slice(1), ps)).toThrow("uniquely match");
    expect(() => matchLibyaPo([...ss, { ...ss[0], id: 90 }], ps)).toThrow("uniquely match");
    expect(() => matchLibyaPo(ss, ps.filter(p => p.month !== 12))).toThrow("uniquely match");
  });
  it("passes the same include/exclude basis through the Excel request", () => {
    expect(parsePerformanceExportQuery({ country: "Libya" })).toMatchObject({ ok: true, request: { includeFoc: true } });
    expect(parsePerformanceExportQuery({ country: "Syria", includeFoc: "false" })).toMatchObject({ ok: true, request: { includeFoc: false } });
    expect(parsePerformanceExportQuery({ country: "Libya", includeFoc: "no" }).ok).toBe(false);
    const ksa = parsePerformanceExportQuery({ country: "KSA", includeFoc: "true" });
    if (ksa.ok) expect(ksa.request.includeFoc).toBeUndefined();
  });
  it.each([true, false])("labels every Excel sheet and printed page with includeFoc=%s and exports FOC quantities", async includeFoc => {
    const pack = buildPack(fixture(), { ...req, includeFoc }, null);
    const buffer = await buildPerformanceWorkbook(pack);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    for (const sheet of wb.worksheets) {
      expect(String(sheet.getCell("A1").value)).toContain(pack.foc!.basisLabel);
      expect(sheet.headerFooter.oddHeader).toContain(pack.foc!.basisLabel);
      expect(sheet.pageSetup.printTitlesRow).toBe("1:2");
    }
    const foc = wb.worksheets.find(s => s.name.endsWith("FOC"))!;
    expect(foc).toBeDefined();
    const cells: (string | number)[] = [];
    foc.eachRow(row => row.eachCell(c => { if (typeof c.value === "number" || typeof c.value === "string") cells.push(c.value); }));
    expect(cells).toContain(11427.58);
    expect(cells).toContain(111500.01);
    expect(cells).toContain(includeFoc ? 122927.59 : 111500.01);
  });
});
