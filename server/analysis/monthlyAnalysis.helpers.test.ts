import { describe, expect, it } from "vitest";
import { buildMonthlyAnalysis, monthlyRef, monthlyRunningRate, monthlySeasonality, monthlyVolatility, overlapsRamadan, suggestedForecast } from "./monthlyAnalysis.helpers";
import { buildSkuSeries, type PerformanceDataset } from "./countryPerformance.helpers";
import { tabRunningRate } from "./countryPerformance.extra";
import type { PerformanceCountry, PerformanceRequest } from "./countryPerformance.types";

const request = (country: PerformanceCountry = "Syria"): PerformanceRequest => ({ country, preset: "ytd", anchor: "2026-09", compare: "ly" });
function fixture(country: PerformanceCountry = "Syria"): PerformanceDataset {
  const periods = Array.from({ length: 36 }, (_, i) => {
    const month = monthlyRef(2025, i + 1);
    return { id: i + 1, year: month.year, month: month.month, label: month.label, sortOrder: i };
  });
  const skus = [
    { id: 1, name: "Al Fakher Mint 50g", weight: "50g", category: "Core", isActive: true },
    { id: 2, name: "Al Fakher Apple 250g", weight: "250g", category: "NPI", isActive: true },
    { id: 3, name: "Inactive", weight: "50g", category: "Core", isActive: false },
    { id: 4, name: "Excluded", weight: "50g", category: "Core", isActive: true, isExcludedFromTotal: true },
  ];
  return {
    country, now: new Date(2026, 9, 10), periods, skus, includeFoc: true,
    ims: skus.flatMap(s => periods.map(p => ({ skuId: s.id, periodId: p.id, value: String(s.id * 100), source: p.id <= 21 ? "manual" : "auto_forecast" }))),
    forecast: skus.flatMap(s => periods.map(p => ({ skuId: s.id, periodId: p.id, value: String(s.id * 110) }))),
    planningFg: skus.map(s => ({ skuId: s.id, periodId: 1, openingStock: "5000", adjustments: "0", arrivals: "0" })),
    shipment: [], arrival: [], actualProduction: [], clearanceEvents: [], foc: [],
  };
}

describe("monthly planner arithmetic", () => {
  it("uses the existing rate method, anchors on the SKU's last sale and adds a 12-month average", () => {
    const values = [80, 0, 100, 100, 200, 300, 0, 0];
    const history = values.map((value, i) => ({ month: monthlyRef(2026, i + 1), value }));
    const actual = monthlyRunningRate(history), trusted = tabRunningRate(values, 7);
    expect(actual).toMatchObject({ avg3: trusted.avg3, avg6: trusted.avg6, last: trusted.last, avg12: 156, lastMonth: "Jun 2026", trendPct: 122.2, direction: "Growing" });
  });
  it("does not invent a trend baseline from zero history", () => {
    expect(monthlyRunningRate([{ month: monthlyRef(2026, 1), value: null }])).toMatchObject({ avg3: 0, lastMonth: null, trendPct: null, direction: "No prior rate" });
  });
  it("calculates seasonality only from available history and counts distinct years", () => {
    const indexes = monthlySeasonality([
      { month: monthlyRef(2025, 1), value: 100 }, { month: monthlyRef(2026, 1), value: 100 },
      { month: monthlyRef(2025, 2), value: 200 }, { month: monthlyRef(2026, 2), value: null },
    ]);
    expect(indexes[0]).toMatchObject({ index: .75, years: 2 });
    expect(indexes[1]).toMatchObject({ index: 1.5, years: 1 });
    expect(indexes[2]).toMatchObject({ index: null, years: 0 });
    expect(indexes[5].summer).toBe(true);
    expect(indexes[8].summer).toBe(false);
  });
  it("marks Ramadan's actual calendar overlap, rather than always March", () => {
    expect(overlapsRamadan(2025, 3)).toBe(true);
    expect(overlapsRamadan(2026, 2)).toBe(true);
    expect(overlapsRamadan(2026, 7)).toBe(false);
  });
  it("keeps true zero observations in volatility but excludes missing ones", () => {
    expect(monthlyVolatility([100, 100, 100, null])).toMatchObject({ months: 3, cvPct: 0, label: "Steady" });
    expect(monthlyVolatility([0, 100, 200, null])).toMatchObject({ months: 3, cvPct: 81.6, label: "Volatile" });
    expect(monthlyVolatility([100, 200])).toMatchObject({ cvPct: null, label: "Thin history" });
    expect(monthlyVolatility([0, 0, 0])).toMatchObject({ cvPct: null, label: "No demand" });
  });
  it.each(["Lebanon", "Syria", "Libya", "KSA"])("suggests six months and uses %s's shared cover rule for both stock paths", country => {
    const months = Array.from({ length: 8 }, (_, i) => monthlyRef(2026, i + 10));
    const indexes = monthlySeasonality(Array.from({ length: 12 }, (_, i) => ({ month: monthlyRef(2025, i + 1), value: 100 })));
    const result = suggestedForecast(100, months, indexes, Array(8).fill(120), 600, Array(8).fill(50), country);
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ suggested: 100, current: 120, differenceMc: 20, differencePct: 20, material: true, currentClosing: 530, suggestedClosing: 550 });
    expect(result[0].suggestedCover).toBeCloseTo(country === "Lebanon" ? 23.65 : 22);
    expect(result[0].currentCover).toBeCloseTo(country === "Lebanon" ? 530 / 120 * 4.3 : 530 / 120 * 4);
    expect(result[5].suggestedClosing).toBe(300);
  });
  it("does not pretend unconfigured entered forecasts are zero or known stock paths", () => {
    const months = Array.from({ length: 8 }, (_, i) => monthlyRef(2026, i + 10));
    const result = suggestedForecast(100, months, [], [0, null], 600, [], "Lebanon");
    expect(result[0]).toMatchObject({ current: 0, material: true, differencePct: -100, currentClosing: 600, currentCover: null });
    expect(result[1]).toMatchObject({ current: null, availablePeriod: false, currentClosing: null, currentCover: null, material: false });
  });
});

describe("monthly planner dataset integration", () => {
  it.each(["Lebanon", "Syria", "Libya", "KSA"] as const)("shares FG stock and run-rate numbers in %s, with inactive/excluded SKUs omitted", country => {
    const ds = fixture(country), result = buildMonthlyAnalysis(ds, request(country));
    expect(result.rows.map(row => row.id)).toEqual(["1", "2"]);
    expect(result.rows[0].stock).toEqual(expect.objectContaining({
      closing: buildSkuSeries(ds)[0].months[20].closing, weeks: buildSkuSeries(ds)[0].months[20].weeks,
    }));
    expect(result.rows[0].rates).toMatchObject({ avg3: 100, avg6: 100, avg12: 100, last: 100 });
    expect(result.totals.find(r => r.id === "country")?.rates.avg3).toBe(300);
    expect(result.totals.find(r => r.id === "country")?.ims.at(-1)).toBe(300);
  });
  it("keeps a 24-calendar-month grid ending at the selected month, with missing cells distinct from zero", () => {
    const ds = fixture();
    ds.ims = ds.ims.filter(r => !(r.skuId === 1 && r.periodId === 21));
    ds.ims.push({ skuId: 1, periodId: 20, value: "0", source: "manual" });
    const result = buildMonthlyAnalysis(ds, request());
    expect(result.gridMonths).toHaveLength(24);
    expect(result.gridMonths[0].key).toBe("2024-10");
    expect(result.gridMonths[23].key).toBe("2026-09");
    expect(result.rows[0].ims[0]).toBeNull();
    expect(result.rows[0].ims[22]).toBe(0);
    expect(result.rows[0].ims[23]).toBeNull();
    expect(result.rows[0].imsTotal).toBe(1900);
  });
  it("excludes auto IMS from rate, history, volatility and forecast-vs-actual without altering the stock ledger", () => {
    const ds = fixture();
    ds.ims.find(r => r.skuId === 1 && r.periodId === 21)!.source = "auto_forecast";
    const result = buildMonthlyAnalysis(ds, request());
    expect(result.rows[0].rates.lastMonth).toBe("Aug 2026");
    expect(result.rows[0].ims.at(-1)).toBeNull();
    expect(result.rows[0].comparison.map(c => c.month.key)).not.toContain("2026-09");
    expect(result.rows[0].volatility.months).toBe(20);
    expect(result.rows[0].stock.closing).toBe(2900);
  });
  it("honours the full page's weight, category, flavour and custom-range filters", () => {
    const result = buildMonthlyAnalysis(fixture(), { ...request(), preset: "custom", from: "2026-07", to: "2026-08",
      filters: { weights: ["50g"], categories: ["Core"], flavours: ["Mint"] } });
    expect(result.rows.map(r => r.id)).toEqual(["1"]);
    expect(result.selectedMonths.map(m => m.key)).toEqual(["2026-07", "2026-08"]);
    expect(result.forecastMonths[0].key).toBe("2026-09");
    expect(result.totals.map(r => r.id)).toEqual(["weight:50g", "country"]);
    expect(result.totals.at(-1)?.rates.avg3).toBe(100);
  });
  it("computes monthly and matched-month cumulative YOY, including observed zero comparisons", () => {
    const ds = fixture();
    ds.ims.find(r => r.skuId === 1 && r.periodId === 21)!.value = "200";
    const result = buildMonthlyAnalysis(ds, request());
    expect(result.rows[0].yoy.at(-1)).toMatchObject({ current: 200, prior: 100, growthPct: 100, cumulativeCurrent: 1000, cumulativePrior: 900, cumulativeGrowthPct: 11.1 });
    expect(result.totals.find(r => r.id === "weight:50g")?.yoy.at(-1)?.growthPct).toBe(100);
  });
  it("compares manual zero IMS against the forecast and identifies persistent forecast bias", () => {
    const ds = fixture();
    ds.ims.find(r => r.skuId === 1 && r.periodId === 21)!.value = "0";
    const result = buildMonthlyAnalysis(ds, request());
    expect(result.rows[0].comparison.at(-1)).toMatchObject({ actual: 0, forecast: 110, gap: 110, gapPct: null });
    expect(result.rows[0].bias.label).toBe("Habitually over-forecast");
  });
  it("keeps historic suggestions point-in-time and totals sum per-SKU suggestions", () => {
    const ds = fixture(), result = buildMonthlyAnalysis(ds, request());
    const futureChanged = structuredClone(ds);
    futureChanged.ims.find(r => r.skuId === 1 && r.periodId === 22)!.value = "999999";
    expect(buildMonthlyAnalysis(futureChanged, request()).rows[0].suggestions).toEqual(result.rows[0].suggestions);
    result.forecastMonths.forEach((_, i) => expect(result.totals.at(-1)!.suggestions[i].suggested).toBe(result.rows.reduce((s, r) => s + r.suggestions[i].suggested, 0)));
    expect(result.rows[0].suggestions[0].current).toBe(110);
  });
  it("handles empty filters and refuses an absent planning calendar explicitly", () => {
    expect(buildMonthlyAnalysis(fixture(), { ...request(), filters: { weights: ["none"] } }).rows).toEqual([]);
    expect(() => buildMonthlyAnalysis({ ...fixture(), periods: [] }, request())).toThrow(/No planning periods/);
  });
  it("applies signed adjustments to both paths while keeping the existing planned receipts fixed", () => {
    const ds = fixture();
    ds.planningFg.push({ skuId: 1, periodId: 22, adjustments: "-25", openingStock: "0", arrivals: "0" });
    const result = buildMonthlyAnalysis(ds, request()).rows[0];
    expect(result.suggestions[0].suggestedClosing).toBe(result.stock.closing + 110 - 25 - 100);
    expect(result.suggestions[0].currentClosing).toBe(result.stock.closing + 110 - 25 - 110);
  });
});
