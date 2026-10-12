import { describe, expect, it } from "vitest";
import { buildPackagingAnalysis, clearOutProjection } from "./packaging.helpers";
import { analysisSkuLabel, applyFilters, buildSkuSeries, resolveWindow, sortedPeriods, type PerformanceDataset } from "./countryPerformance.helpers";
import { buildMonthlyAnalysis, monthlyRef } from "./monthlyAnalysis.helpers";
import { buildPack } from "./countryPerformance";
import { buildPerformanceWorkbook } from "./countryPerformanceExcel";
import ExcelJS from "exceljs";

function fixture(country: PerformanceDataset["country"] = "Syria"): PerformanceDataset {
  const periods = Array.from({ length: 36 }, (_, i) => {
    const m = monthlyRef(2025, i + 1);
    return { id: i + 1, year: m.year, month: m.month, label: m.label, sortOrder: i };
  });
  const skus = [
    { id: 1, name: "Al Fakher Double Apple 50g", weight: "50g", packagingType: "Old", category: "Core", isActive: true },
    { id: 2, name: "Al Fakher Double Apple 50g", weight: "50g", packagingType: "New", category: "Core", isActive: true },
    { id: 3, name: "Al Fakher Mint 50g", weight: "50g", packagingType: "Old", category: "NPI", isActive: true },
    { id: 4, name: "Inactive", weight: "50g", packagingType: "Old", category: "Core", isActive: false },
  ];
  return { country, now: new Date(2026, 9, 12), periods, skus,
    ims: skus.flatMap(s => periods.map(p => ({ skuId: s.id, periodId: p.id, value: String(s.id === 1 ? 100 : s.id === 2 ? 200 : 0), source: p.id <= 21 ? "manual" : "auto_forecast" }))),
    forecast: skus.flatMap(s => periods.map(p => ({ skuId: s.id, periodId: p.id, value: "100" }))),
    planningFg: skus.map(s => ({ skuId: s.id, periodId: 1, openingStock: "6000", adjustments: "0", arrivals: "0" })),
    shipment: [], arrival: [], actualProduction: [], clearanceEvents: [],
    expiryRows: [{ skuId: 3, skuName: "Al Fakher Mint 50g", weight: "50g", productionPeriodLabel: "Jan 2025", productionDate: "2025-01-01", expiryDate: "2026-11-01", totalRemaining: 600, monthsUntilExpiry: 1 }],
  };
}
function calculate(ds = fixture(), packaging?: string[]) {
  const filtered = applyFilters(ds.skus.filter(s => s.isActive !== false && !s.isExcludedFromTotal), packaging ? { packaging } : undefined);
  const ids = new Set(filtered.map(s => s.id));
  return buildPackagingAnalysis(ds, resolveWindow(sortedPeriods(ds), "ytd", 20), buildSkuSeries(ds, ds.skus).filter(s => ids.has(s.sku.id)));
}

describe("packaging stock is separate inventory", () => {
  it("projects fractional months, rounds the clear-out month up and crosses years", () => {
    expect(clearOutProjection(250, 100, 2026, 9)).toEqual({ monthsToClear: 2.5, projectedClearMonth: "2026-12" });
    expect(clearOutProjection(100, 100, 2026, 12)).toEqual({ monthsToClear: 1, projectedClearMonth: "2027-01" });
    expect(clearOutProjection(0, 0, 2026, 9)).toEqual({ monthsToClear: 0, projectedClearMonth: "2026-09" });
    expect(clearOutProjection(100, 0, 2026, 9)).toEqual({ monthsToClear: null, projectedClearMonth: null });
    expect(clearOutProjection(-1, 0, 2026, 9).monthsToClear).toBe(0);
    expect(clearOutProjection(0.1, 100, 2026, 9).projectedClearMonth).toBe("2026-10");
  });
  it("labels identical flavour/weight SKUs distinctly even when all SKUs have one pack", () => {
    const ds = fixture();
    expect(analysisSkuLabel(ds.skus[0])).toBe("Double Apple · 50g · Old");
    expect(analysisSkuLabel(ds.skus[1])).toBe("Double Apple · 50g · New");
    ds.skus.forEach(s => { s.packagingType = "New"; });
    expect(calculate(ds).enabled).toBe(false);
    ds.skus[3].packagingType = "Old";
    expect(calculate(ds).enabled).toBe(false);
  });
  it("respects packaging filters without inventing an absent cohort", () => {
    const p = calculate(fixture(), ["Old"]);
    expect(p.enabled).toBe(true);
    expect(p.groups.map(g => g.packaging)).toEqual(["Old"]);
    expect(p.groups[0].skuCount).toBe(2);
    expect(p.groups[0].metrics.ims.sharePct).toBe(100);
    expect(p.pairs).toEqual([]);
    expect(p.months.every(m => m.newIms === null)).toBe(true);
  });
  it("uses each pack's own IMS rate and pairs by flavour AND weight", () => {
    const p = calculate();
    expect(p.groups.map(g => g.packaging)).toEqual(["Old", "New"]);
    const old = p.groups[0], next = p.groups[1];
    expect(old.metrics.runRate.value).toBe(100);
    expect(next.metrics.runRate.value).toBe(200);
    expect(old.metrics.ims).toMatchObject({ value: 900, sharePct: 33.3, lastYear: 900, changePct: 0 });
    expect(p.pairs).toHaveLength(1);
    expect(p.pairs[0]).toMatchObject({ flavour: "Double Apple", weight: "50g", old: { ims: 900, sharePct: 33.3 }, new: { ims: 1800, sharePct: 66.7 } });
    expect(p.pairs[0].old.coverWeeks).toBeCloseTo(p.pairs[0].old.stock / 100 * 4);
    expect(p.pairs[0].new.coverWeeks).toBeCloseTo(p.pairs[0].new.stock / 200 * 4);
    expect(p.stalled.find(s => s.skuId === 3)).toMatchObject({ stock: 6000, runRate: 0, monthsToClear: null });
    expect(old.aggregateMonthsAtRate).toBe(99);
    expect(old.monthsToClear).toBeNull();
    expect(old.projectedClearMonth).toBeNull();
  });
  it("excludes auto-filled/future IMS and never substitutes New sales for Old expiry demand", () => {
    const ds = fixture(), p = calculate(ds);
    expect(p.expiry).toEqual([expect.objectContaining({ skuId: 3, sku: "Mint · 50g · Old", atRiskMc: 600 })]);
    expect(calculate(fixture("Lebanon")).expiry).toEqual([]);
    ds.ims.filter(r => r.skuId === 1).forEach(r => { r.source = "auto_forecast"; });
    expect(calculate(ds).groups[0].metrics.runRate.value).toBe(0);
    expect(calculate(ds).groups[0].monthsToClear).toBeNull();
  });
  it("adds packaging totals without changing country totals or doubling suggestions", () => {
    const ds = fixture();
    const result = buildMonthlyAnalysis(ds, { country: ds.country, preset: "ytd", anchor: "2026-09", compare: "ly" });
    const country = result.totals.find(r => r.id === "country")!;
    const packages = result.totals.filter(r => r.id.startsWith("packaging:"));
    expect(packages).toHaveLength(2);
    expect(packages.reduce((v, r) => v + r.rates.avg3, 0)).toBe(country.rates.avg3);
    for (let i = 0; i < 6; i++) expect(packages.reduce((v, r) => v + r.suggestions[i].suggested, 0)).toBe(country.suggestions[i].suggested);
    expect(result.rows.every(r => / · (Old|New)$/.test(r.sku))).toBe(true);
  });
  it("does not project stale Old sales when three recorded recent months have zero demand", () => {
    const ds = fixture();
    ds.ims.filter(r => r.skuId === 1 && [19, 20, 21].includes(r.periodId)).forEach(r => { r.value = "0"; });
    const p = calculate(ds);
    expect(p.groups[0].metrics.runRate.value).toBe(100);
    expect(p.stalled.find(s => s.skuId === 1)?.runRate).toBe(0);
    expect(p.groups[0].projectedClearMonth).toBeNull();
  });
  it("adds the Summary transition message, expiry risk and valid unit-aware Excel export", async () => {
    const ds = fixture();
    const pack = buildPack(ds, { country: ds.country, preset: "ytd", anchor: "2026-09", compare: "ly" }, null);
    expect(pack.executive.keyMessages.some(m => m.headline.includes("Old packaging"))).toBe(true);
    expect(pack.executive.risks.some(r => r.sku === "Mint · 50g · Old" && r.issue.includes("Old packaging"))).toBe(true);
    expect(pack.runningRate.byPackaging?.map(r => r.group)).toEqual(["New", "Old"]);
    expect(pack.stockSituation.rows.every(r => / · (Old|New)$/.test(r.sku))).toBe(true);
    const buffer = await buildPerformanceWorkbook(pack, { unit: "KG" });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(Uint8Array.from(buffer).buffer);
    expect(book.getWorksheet("Old versus New")).toBeDefined();
    const strings = book.getWorksheet("Old versus New")!.getSheetValues().flat().flat().filter(v => typeof v === "string");
    expect(strings.some(v => String(v).includes("(KG)"))).toBe(true);
    expect(strings).toContain("Mint · 50g · Old");
    ds.skus.forEach(s => { s.packagingType = "New"; });
    const single = buildPack(ds, { country: ds.country, preset: "ytd", anchor: "2026-09", compare: "ly" }, null);
    const singleBook = new ExcelJS.Workbook();
    await singleBook.xlsx.load(Uint8Array.from(await buildPerformanceWorkbook(single)).buffer);
    expect(singleBook.getWorksheet("Old versus New")).toBeUndefined();
  });
});
