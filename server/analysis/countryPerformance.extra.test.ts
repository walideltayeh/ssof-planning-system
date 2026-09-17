import { describe, expect, it } from "vitest";
import { compareHeadlines } from "../../shared/performance/boardCompare";
import { buildPack } from "./countryPerformance";
import {
  baselineFromSnapshot,
  buildMarket,
  buildRunningRate,
  buildVolumeBridge,
  detectAnomalies,
  gramsOf,
  tabRunningRate,
} from "./countryPerformance.extra";
import { buildSkuSeries, computeExpectedArrival, monthlyTotals, resolveWindow, sortedPeriods, sum, type DatasetPeriod, type DatasetSku, type PerformanceDataset } from "./countryPerformance.helpers";
import type { BoardHeadline } from "./countryPerformance.types";

const NOW = new Date("2026-09-15T10:00:00Z");

function makePeriods(fromYear: number, toYear: number): DatasetPeriod[] {
  const out: DatasetPeriod[] = [];
  let id = 1;
  const names = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  for (let y = fromYear; y <= toYear; y++) for (let m = 1; m <= 12; m++) out.push({ id: id++, year: y, month: m, label: `${names[m]} ${y}`, sortOrder: id });
  return out;
}
const periods = makePeriods(2025, 2026);
const pid = (y: number, m: number) => periods.find((p) => p.year === y && p.month === m)!.id;

const skus: DatasetSku[] = [
  { id: 1, name: "Al Fakher Two Apples 50g", weight: "50g", category: "Core", packagingType: "New", priceToWs: "120" },
  { id: 2, name: "Al Fakher Grape 250g", weight: "250g", category: "Core", packagingType: "Old", priceToWs: null },
  { id: 3, name: "Al Fakher Magic Love 50g", weight: "50g", category: "NPI", packagingType: "New", priceToWs: "130" },
];
const inactiveSku: DatasetSku = { id: 9, name: "Al Fakher Mint 250g", weight: "250g", category: "Core", packagingType: "Old", priceToWs: null, isActive: false };

/** Steady dataset: IMS = 100/200/50 per SKU every month, forecast = IMS + 10, actual IMS through Aug 2026. */
function dataset(overrides: Partial<PerformanceDataset> = {}): PerformanceDataset {
  const base: Record<number, number> = { 1: 100, 2: 200, 3: 50 };
  const forecast = [];
  const ims = [];
  const shipment = [];
  const planningFg = [];
  const clearanceEvents = [];
  for (const s of skus) {
    for (const p of periods) {
      const past = p.year < 2026 || (p.year === 2026 && p.month <= 8);
      // Two Apples grows 10% in 2026, Magic Love only starts selling in 2026.
      const level = s.id === 1 && p.year === 2026 ? base[1] * 1.1 : s.id === 3 && p.year === 2025 ? 0 : base[s.id];
      forecast.push({ skuId: s.id, periodId: p.id, value: String(level + 10) });
      if (past) ims.push({ skuId: s.id, periodId: p.id, value: String(level), source: "manual" });
      else ims.push({ skuId: s.id, periodId: p.id, value: String(level + 10), source: "auto_forecast" });
      shipment.push({ skuId: s.id, periodId: p.id, week1: String(level), week2: "0", week3: "0", week4: "0", arrivalOffsetValue: 0, arrivalOffsetUnit: "days", arrivalStatus: past ? "Cleared" : "Pending", note: null });
      if (past && level > 0) clearanceEvents.push({ id: p.id * 10 + s.id, skuId: s.id, periodId: p.id, clearedQty: String(level), clearedDate: computeExpectedArrival(p.year, p.month, 0, "days"), invoiceRef: null, containerRef: null });
      if (p.id === periods[0].id) planningFg.push({ skuId: s.id, periodId: p.id, openingStock: "600", adjustments: "0", arrivals: "0" });
    }
  }
  return {
    country: "Syria",
    skus,
    periods,
    forecast,
    ims,
    shipment,
    arrival: [],
    planningFg,
    clearanceEvents,
    actualProduction: [],
    expiryRows: [],
    inactiveSkus: [inactiveSku],
    inactiveIms: periods.filter((p) => p.year === 2025).map((p) => ({ skuId: 9, periodId: p.id, value: "30", source: "manual" })),
    now: NOW,
    ...overrides,
  };
}

describe("running rate (tab method)", () => {
  it("averages only the months with sales and anchors on the SKU's last selling month", () => {
    // Tab logic: last data idx = index 5 (value 300); last 3 = [100, 200, 300] → 200;
    // last 6 = [50, 100, 0, 100, 200, 300] → non-zero avg 150; prior 3 = [50, 100, 0] → 75.
    const r = tabRunningRate([50, 100, 0, 100, 200, 300, 0, 0], 7);
    expect(r.lastIdx).toBe(5);
    expect(r.avg3).toBe(200);
    expect(r.avg6).toBe(150);
    expect(r.prior3).toBe(75);
    expect(r.last).toBe(300);
  });

  it("respects the end index so the strip never reads beyond the selected period", () => {
    const r = tabRunningRate([100, 200, 300, 400], 1);
    expect(r.avg3).toBe(150);
    expect(r.lastIdx).toBe(1);
  });

  it("matches the Running Rate tab on the steady fixture and excludes auto-filled months", () => {
    const ds = dataset();
    const ps = sortedPeriods(ds);
    const series = buildSkuSeries(ds, ds.skus);
    const w = resolveWindow(ps, "ytd", ps.findIndex((p) => p.year === 2026 && p.month === 8));
    const mPlan = monthlyTotals(series, ps, (c) => c.forecast);
    const mIms = monthlyTotals(series, ps, (c) => c.ims);
    const mImsActual = ps.map((_, i) => (series.some((s) => s.months[i].imsIsActual) ? sum(series.map((s) => (s.months[i].imsIsActual ? s.months[i].ims : 0))) : null));
    const rr = buildRunningRate({ country: "Syria", series, periods: ps, w, latestActualIdx: w.toIdx, mPlan, mIms, mImsActual, rule: { mode: "sameMonth", factor: 4 } });
    expect(rr.asOf).toBe("Aug 2026");
    expect(rr.headline.value).toBe(360); // 110 + 200 + 50
    expect(rr.avg3.value).toBe(360);
    expect(rr.avg3.plan).toBe(390);
    expect(rr.headline.lastYear).toBe(300); // Aug 2025: 100 + 200 + 0
    expect(rr.headline.vsLyPct).toBeCloseTo(20, 1);
    expect(rr.annualised).toBe(360 * 12);
    expect(rr.chart).toHaveLength(20); // Jan'25..Aug'26
    expect(rr.chart.every((c) => c.isActual)).toBe(true);
    expect(rr.byType.map((t) => t.group)).toEqual(["Core", "NPI"]);
    expect(rr.byWeight.map((t) => t.group)).toEqual(["50g", "250g"]);
    expect(rr.trend.direction).toBe("flat");
    expect(rr.message).toContain("360 MC/month");
  });

  it("orders weights by grams", () => {
    expect(["1kg", "50g", "250g"].sort((a, b) => gramsOf(a) - gramsOf(b))).toEqual(["50g", "250g", "1kg"]);
  });
});

describe("volume bridge", () => {
  it("splits LY→TY into core, NPI and lost inactive volume", () => {
    const ds = dataset();
    const ps = sortedPeriods(ds);
    const series = buildSkuSeries(ds, ds.skus);
    const w = resolveWindow(ps, "ytd", ps.findIndex((p) => p.year === 2026 && p.month === 8));
    const lyW = resolveWindow(ps, "ytd", ps.findIndex((p) => p.year === 2025 && p.month === 8));
    const inactive = [{ sku: inactiveSku, ims: ps.map((p) => (p.year === 2025 ? 30 : 0)) }];
    const bridge = buildVolumeBridge({ series, periods: ps, w, lyW, inactive, windowLabel: "Jan–Aug 2026", lyLabel: "Jan–Aug 2025" });
    expect(bridge.available).toBe(true);
    const step = (k: string) => bridge.steps.find((s) => s.key === k)!.value;
    expect(step("ly")).toBe(8 * (100 + 200 + 30));
    expect(step("core")).toBe(8 * 10);
    expect(step("npi")).toBe(8 * 50);
    expect(step("lost")).toBe(-8 * 30);
    expect(step("ty")).toBe(8 * (110 + 200 + 50));
    expect(step("ly") + step("core") + step("npi") + step("lost")).toBe(step("ty"));
    const wSum = bridge.byWeight.filter((s) => s.kind === "delta").reduce((a, s) => a + s.value, 0);
    expect(step("ly") + wSum).toBe(step("ty"));
  });
});

describe("anomaly detection", () => {
  it("flags a spike against a stable history and ignores normal noise", () => {
    const values = [100, 102, 98, 101, 99, 100, 103, 97, 100, 250, 101, 99];
    const hits = detectAnomalies(values);
    expect(hits.map((h) => h.idx)).toEqual([9]);
    expect(hits[0].z).toBeGreaterThan(2.5);
    expect(detectAnomalies([100, 102, 98, 101, 99, 100, 103, 97, 100, 101])).toHaveLength(0);
    // A sustained step is reported once; a zero history is never a baseline.
    expect(detectAnomalies([100, 100, 100, 100, 100, 100, 200, 200, 200]).map((h) => h.idx)).toEqual([6]);
    expect(detectAnomalies([0, 0, 0, 0, 0, 0, 50, 50])).toHaveLength(0);
  });
});

describe("market context", () => {
  const competitor = {
    brandMonthly: {
      "Al Fakher": { "2025": [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50], "2026": [60, 60, 60, 60, 60, 60, 60, 60, 0, 0, 0, 0] },
      Mazaya: { "2025": [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30], "2026": [30, 30, 30, 30, 30, 30, 30, 30, 0, 0, 0, 0] },
      Others: { "2025": [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], "2026": [20, 20, 20, 20, 20, 20, 20, 20, 0, 0, 0, 0] },
    },
    uploadedBy: "walid",
    uploadedAt: "2026-09-01T00:00:00.000Z",
  };
  it("computes share, growth vs market and the main competitor", () => {
    const m = buildMarket({ competitor, year: 2026, endMonth: 8 })!;
    expect(m.available).toBe(true);
    expect(m.monthsCovered).toBe(8);
    expect(m.mainCompetitor).toBe("Mazaya");
    expect(m.sharePct).toBeCloseTo((60 / 110) * 100, 1);
    expect(m.shareLyPct).toBeCloseTo(50, 1);
    expect(m.ourGrowthPct).toBeCloseTo(20, 1);
    expect(m.marketGrowthPct).toBeCloseTo(10, 1);
    expect(m.outgrowing).toBe(true);
    expect(m.brands[0].brand).toBe("Al Fakher");
    expect(m.message).toContain("outgrowing");
  });
  it("hides when there is no competitor upload", () => {
    expect(buildMarket({ competitor: null, year: 2026, endMonth: 8 })).toBeNull();
  });
});

describe("budget baseline from a saved version", () => {
  it("matches snapshot forecast by SKU name and calendar month, not by id", () => {
    const b = baselineFromSnapshot({
      id: 7,
      name: "Budget 2026",
      createdAt: "2026-01-05T00:00:00.000Z",
      snapshotData: {
        skus: [{ id: 101, name: "Al Fakher Two Apples 50g", weight: "50g" }],
        periods: [{ id: 55, year: 2026, month: 3 }],
        forecast: [{ skuId: 101, periodId: 55, value: "123" }],
      },
    });
    expect(b.versionId).toBe(7);
    expect(b.forecast.get("Al Fakher Two Apples 50g|50g|2026-3")).toBe(123);
    expect(b.savedAt).toBe("2026-01-05T00:00:00.000Z");
  });
});

describe("buildPack board additions", () => {
  it("produces the running rate, outlook, portfolio, lost sales, efficiency, anomalies and headline together", () => {
    const ds = dataset();
    const pack = buildPack(ds, { country: "Syria", preset: "ytd", compare: "plan" }, null);
    expect(pack.runningRate.asOf).toBe("Aug 2026");
    expect(pack.runningRate.headline.value).toBe(360);
    expect(pack.outlook.year).toBe(2026);
    expect(pack.outlook.monthsElapsed).toBe(8);
    expect(pack.outlook.monthsRemaining).toBe(4);
    expect(pack.outlook.baseline.kind).toBe("current");
    expect(pack.outlook.total.ytdActual).toBe(8 * 360);
    expect(pack.outlook.total.remainingForecast).toBe(4 * 390);
    expect(pack.outlook.total.landing).toBe(8 * 360 + 4 * 390);
    expect(pack.outlook.total.annualPlan).toBe(12 * 390);
    expect(pack.outlook.total.requiredRate).toBe(Math.round((12 * 390 - 8 * 360) / 4));
    expect(pack.outlook.monthly).toHaveLength(12);
    expect(pack.demand.bridge.available).toBe(true);
    expect(pack.portfolio.points).toHaveLength(3);
    expect(pack.portfolio.flavours[0].flavour).toBe("Grape");
    expect(pack.inventory.lostSales.serviceLevelPct).not.toBeNull();
    expect(pack.inventory.efficiency.total.turns).not.toBeNull();
    expect(pack.inventory.efficiency.variability).toHaveLength(3);
    expect(pack.market).toBeNull();
    // The NPI launch lifts 50g by 60% in Jan 2026: reported once, not again in Feb, and never against a zero history.
    expect(pack.anomalies.rows).toContainEqual(expect.objectContaining({ scope: "weight", name: "50g", measure: "IMS", month: "Jan'26", direction: "above" }));
    expect(pack.anomalies.rows.some((r) => r.month === "Feb'26")).toBe(false);
    expect(pack.anomalies.rows.every((r) => r.expected > 0)).toBe(true);
    expect(pack.headline.version).toBe(1);
    expect(pack.headline.ytdIms).toBe(8 * 360);
    expect(pack.headline.skuForecasts).toHaveLength(3);
    expect(pack.headline.skuForecasts.find((f) => f.sku === "Al Fakher Grape 250g")!.remainingForecast).toBe(4 * 210);
  });

  it("uses the chosen budget version as the annual plan", () => {
    const ds = dataset();
    const forecast = new Map<string, number>();
    for (const s of skus) for (let m = 1; m <= 12; m++) forecast.set(`${s.name}|${s.weight}|2026-${m}`, 500);
    const pack = buildPack(ds, { country: "Syria", preset: "ytd", compare: "plan" }, null, { versionId: 3, versionName: "Budget 2026", savedAt: null, forecast });
    expect(pack.outlook.baseline.kind).toBe("version");
    expect(pack.outlook.total.annualPlan).toBe(12 * 1500);
    expect(pack.outlook.byWeight.find((g) => g.group === "250g")!.annualPlan).toBe(12 * 500);
  });
});

describe("board comparison", () => {
  const headline = (over: Partial<BoardHeadline>): BoardHeadline => ({
    version: 1,
    country: "Syria",
    windowLabel: "Jan–Aug 2026",
    year: 2026,
    asOf: "Aug 2026",
    generatedAt: "2026-09-01T00:00:00.000Z",
    ytdIms: 1000,
    ytdPlan: 1100,
    landing: 1600,
    annualPlan: 1700,
    remainingForecast: 600,
    runningRate: 120,
    closingStock: 400,
    weeksOfCover: 5,
    forecastAccuracyPct: 80,
    stockoutRiskSkus: 1,
    overstockSkus: 2,
    risks: [{ sku: "A", issue: "Stock-out risk", severity: "red" }],
    skuForecasts: [
      { sku: "A", weight: "50g", remainingForecast: 300 },
      { sku: "B", weight: "250g", remainingForecast: 300 },
    ],
    ...over,
  });
  it("lists headline deltas, risk changes and the largest forecast revisions", () => {
    const prev = headline({});
    const cur = headline({
      ytdIms: 1150,
      landing: 1650,
      runningRate: 130,
      risks: [{ sku: "B", issue: "Overstock", severity: "amber" }],
      skuForecasts: [
        { sku: "A", weight: "50g", remainingForecast: 250 },
        { sku: "B", weight: "250g", remainingForecast: 320 },
      ],
    });
    const c = compareHeadlines(cur, prev);
    expect(c.changes.find((x) => x.key === "ytdIms")!.delta).toBe(150);
    expect(c.changes.find((x) => x.key === "landing")!.pct).toBeCloseTo(3.1, 1);
    expect(c.risksAdded.map((r) => r.sku)).toEqual(["B"]);
    expect(c.risksResolved.map((r) => r.sku)).toEqual(["A"]);
    expect(c.forecastRevisions[0]).toMatchObject({ sku: "A", delta: -50 });
    expect(c.totalForecastRevisionMc).toBe(-30);
    expect(c.summary).toContain("landing estimate up 50 MC");
    expect(c.summary).toContain("1 new risk");
  });
  it("does not compare forecasts across planning years", () => {
    const c = compareHeadlines(headline({ year: 2027 }), headline({}));
    expect(c.sameYear).toBe(false);
    expect(c.forecastRevisions).toHaveLength(0);
  });
});
