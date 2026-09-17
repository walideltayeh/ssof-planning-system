import { describe, expect, it } from "vitest";
import {
  accuracyOf,
  accuracySamples,
  applyFilters,
  buildBatches,
  buildKeyMessages,
  buildRisks,
  buildSkuSeries,
  chronicBias,
  clearanceByClearedMonth,
  computeExpectedArrival,
  confidenceScore,
  expiryAtRisk,
  flavourOf,
  lastYearWindow,
  latestActualImsIndex,
  paretoRows,
  plannedArrivalsMap,
  previousWindow,
  projectionInputs,
  ragCover,
  ragVsPlan,
  resolveWindow,
  runningRate,
  seasonalityIndex,
  shortfallBeforeNextArrival,
  stockoutRisk,
  topMovers,
  totalWeeksAt,
  type DatasetPeriod,
  type DatasetSku,
  type PerformanceDataset,
} from "./countryPerformance.helpers";
import { buildPack } from "./countryPerformance";
import { aggregateProjection, classifyZone, coverRuleFor, findStockout, mcForWeeks, projectSku, weeksOfCoverAt } from "../../shared/performance/projection";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date(2026, 8, 17); // 17 Sep 2026

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

/** Deterministic pseudo-random values so the fixture is stable but not trivial. */
function seeded(skuId: number, periodId: number, salt: number): number {
  const x = Math.sin(skuId * 97 + periodId * 13 + salt) * 10000;
  return Math.round((x - Math.floor(x)) * 900 + 100);
}

function intlDataset(overrides: Partial<PerformanceDataset> = {}): PerformanceDataset {
  const forecast = [];
  const ims = [];
  const shipment = [];
  const actualProduction = [];
  const planningFg = [];
  const clearanceEvents = [];
  for (const s of skus) {
    for (const p of periods) {
      forecast.push({ skuId: s.id, periodId: p.id, value: String(seeded(s.id, p.id, 1)) });
      const past = p.year < 2026 || (p.year === 2026 && p.month <= 8);
      if (past) ims.push({ skuId: s.id, periodId: p.id, value: String(seeded(s.id, p.id, 2)), source: "manual" });
      else if (p.year === 2026 && p.month <= 12) ims.push({ skuId: s.id, periodId: p.id, value: String(seeded(s.id, p.id, 1)), source: "auto_forecast" });
      const produced = seeded(s.id, p.id, 3);
      shipment.push({ skuId: s.id, periodId: p.id, week1: String(produced), week2: "0", week3: "0", week4: "0", arrivalOffsetValue: 45, arrivalOffsetUnit: "days", arrivalStatus: past ? "Cleared" : "Pending", note: null });
      if (past && p.month % 2 === 0) actualProduction.push({ skuId: s.id, periodId: p.id, value: String(produced + 20) });
      if (past) {
        const cd = computeExpectedArrival(p.year, p.month, 45, "days");
        clearanceEvents.push({ id: p.id * 10 + s.id, skuId: s.id, periodId: p.id, clearedQty: String(produced), clearedDate: cd, invoiceRef: `INV-${p.id}`, containerRef: null });
      }
      if (p.id === periods[0].id) planningFg.push({ skuId: s.id, periodId: p.id, openingStock: "1500", adjustments: "0", arrivals: "0" });
      else if (p.month === 5) planningFg.push({ skuId: s.id, periodId: p.id, openingStock: "0", adjustments: "-25", arrivals: "0" });
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
    actualProduction,
    expiryRows: [],
    now: NOW,
    ...overrides,
  };
}

function lebanonDataset(): PerformanceDataset {
  const base = intlDataset({ country: "Lebanon", clearanceEvents: [] });
  const arrival = [];
  for (const s of skus) {
    for (const p of periods) {
      arrival.push({ skuId: s.id, periodId: p.id, week1: String(seeded(s.id, p.id, 4)), week2: "10", week3: "0", week4: "0", arrivalOffsetWeeks: 4 });
    }
  }
  // Planning FG arrivals override for one month
  base.planningFg.push({ skuId: 1, periodId: pid(2026, 3), openingStock: "0", adjustments: "0", arrivals: "777" });
  return { ...base, arrival };
}

// ── Reference implementations transcribed from the Planning FG pages ─────────

/** IntlPlanningFgPage.getRowValues, transcribed. */
function referenceIntlClosing(ds: PerformanceDataset, skuId: number): number[] {
  const sorted = [...ds.periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const key = (p: DatasetPeriod) => `${skuId}-${p.id}`;
  const planningMap = new Map(ds.planningFg.filter((r) => r.skuId === skuId).map((r) => [`${skuId}-${r.periodId}`, { openingStock: parseFloat(r.openingStock ?? "0") || 0, adjustments: parseFloat(r.adjustments ?? "0") || 0 }]));
  const imsMap = new Map(ds.ims.filter((r) => r.skuId === skuId).map((r) => [`${skuId}-${r.periodId}`, parseFloat(r.value ?? "0") || 0]));
  const arrivalMap = new Map<string, number>();
  for (const ce of ds.clearanceEvents) {
    if (ce.skuId !== skuId || !ce.clearedDate) continue;
    const cd = ce.clearedDate instanceof Date ? ce.clearedDate : new Date(ce.clearedDate);
    const period = sorted.find((p) => p.month === cd.getMonth() + 1 && p.year === cd.getFullYear());
    if (!period) continue;
    arrivalMap.set(key(period), (arrivalMap.get(key(period)) ?? 0) + (parseFloat(String(ce.clearedQty ?? "0")) || 0));
  }
  const out: number[] = [];
  let prevClosing = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const pg = planningMap.get(key(p)) ?? { openingStock: 0, adjustments: 0 };
    const ims = imsMap.get(key(p)) ?? 0;
    const arrivals = arrivalMap.get(key(p)) ?? 0;
    const opening = i === 0 ? pg.openingStock : prevClosing;
    const closing = opening + pg.adjustments + arrivals - ims;
    out.push(closing);
    prevClosing = closing;
  }
  return out;
}

/** PlanningFgPage.calculateSkuData, transcribed. */
function referenceLebanonClosing(ds: PerformanceDataset, skuId: number, now: Date): number[] {
  const sorted = [...ds.periods].sort((a, b) => a.sortOrder - b.sortOrder);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const imsMap = new Map(ds.ims.filter((r) => r.skuId === skuId).map((r) => [r.periodId, r.value ?? "0"]));
  const forecastMap = new Map(ds.forecast.filter((r) => r.skuId === skuId).map((r) => [r.periodId, r.value ?? "0"]));
  const planningMap = new Map(ds.planningFg.filter((r) => r.skuId === skuId).map((r) => [r.periodId, r]));
  const arrivalMap = new Map(ds.arrival.filter((r) => r.skuId === skuId).map((r) => [r.periodId, ["week1", "week2", "week3", "week4"].reduce((t, k) => t + (parseFloat((r as unknown as Record<string, string | null>)[k] ?? "0") || 0), 0)]));
  const getEffectiveIms = (periodId: number) => {
    const imsVal = parseFloat(imsMap.get(periodId) ?? "0") || 0;
    if (imsVal !== 0) return imsVal;
    const period = sorted.find((p) => p.id === periodId);
    if (period && (period.year > currentYear || (period.year === currentYear && period.month > currentMonth))) return parseFloat(forecastMap.get(periodId) ?? "0") || 0;
    return 0;
  };
  const out: number[] = [];
  let prevClosingStock = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const planData = planningMap.get(p.id);
    const ims = getEffectiveIms(p.id);
    const planningArrivals = parseFloat(planData?.arrivals ?? "0") || 0;
    const arrival = planningArrivals !== 0 ? planningArrivals : arrivalMap.get(p.id) ?? 0;
    const openingStock = i === 0 ? parseFloat(planData?.openingStock ?? "0") || 0 : prevClosingStock;
    const adjustments = parseFloat(planData?.adjustments ?? "0") || 0;
    const closingStock = openingStock + adjustments + arrival - ims;
    out.push(closingStock);
    prevClosingStock = closingStock;
  }
  return out;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("closing stock reconciliation with Planning FG", () => {
  it("matches the Syria/Libya/KSA Planning FG chain for every SKU and month", () => {
    const ds = intlDataset();
    const series = buildSkuSeries(ds);
    for (const s of series) {
      const ref = referenceIntlClosing(ds, s.sku.id);
      expect(s.months.map((m) => m.closing)).toEqual(ref);
    }
  });

  it("matches the Lebanon Planning FG chain (effective IMS, planning arrivals override)", () => {
    const ds = lebanonDataset();
    const series = buildSkuSeries(ds);
    for (const s of series) {
      const ref = referenceLebanonClosing(ds, s.sku.id, NOW);
      expect(s.months.map((m) => m.closing)).toEqual(ref);
    }
    // The override month must use the Planning FG arrivals, not the arrival sheet.
    const sku1 = series.find((s) => s.sku.id === 1)!;
    expect(sku1.months.find((m) => m.period.id === pid(2026, 3))!.arrivals).toBe(777);
  });

  it("uses the intl weeks rule (÷ same-month IMS × 4) and the Lebanon rule (÷ next-two average × 4.3)", () => {
    const intl = buildSkuSeries(intlDataset())[0];
    const i = intl.months.findIndex((m) => m.period.id === pid(2026, 6));
    const c = intl.months[i];
    expect(c.weeks).toBeCloseTo((c.closing / c.ims) * 4, 6);
    const leb = buildSkuSeries(lebanonDataset())[0];
    const j = leb.months.findIndex((m) => m.period.id === pid(2026, 6));
    const l = leb.months[j];
    const avg = (leb.months[j + 1].effectiveIms + leb.months[j + 2].effectiveIms) / 2;
    expect(l.weeks).toBeCloseTo((l.closing / avg) * 4.3, 6);
  });

  it("marks stock with no sales as undefined cover (∞ on the page) rather than a number", () => {
    expect(weeksOfCoverAt(100, [0], 0, coverRuleFor("Syria"))).toBeNull();
    expect(weeksOfCoverAt(0, [0], 0, coverRuleFor("Syria"))).toBe(0);
    expect(weeksOfCoverAt(100, [0, 0, 0], 0, coverRuleFor("Lebanon"))).toBeNull();
    expect(classifyZone(null, 100)).toBe("Overstock");
    expect(classifyZone(null, -5)).toBe("Negative");
    expect(classifyZone(5, 10)).toBe("Healthy");
    expect(classifyZone(3.9, 10)).toBe("Critical");
    expect(classifyZone(6.1, 10)).toBe("Overstock");
  });

  it("clearance events are bucketed by cleared-date month, not production month", () => {
    const m = clearanceByClearedMonth([{ skuId: 1, periodId: pid(2026, 1), clearedQty: "50", clearedDate: "2026-03-05" }], periods);
    expect(m.get(`1-${pid(2026, 3)}`)).toBe(50);
    expect(m.get(`1-${pid(2026, 1)}`)).toBeUndefined();
  });
});

describe("windows", () => {
  it("resolves month / QTD / YTD / L12M / custom around an anchor", () => {
    const a = periods.findIndex((p) => p.year === 2026 && p.month === 8);
    expect(resolveWindow(periods, "month", a).months.map((p) => p.month)).toEqual([8]);
    expect(resolveWindow(periods, "qtd", a).months.map((p) => p.month)).toEqual([7, 8]);
    expect(resolveWindow(periods, "ytd", a).months.map((p) => p.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(resolveWindow(periods, "l12m", a).months).toHaveLength(12);
    const c = resolveWindow(periods, "custom", a, "2026-02", "2026-04");
    expect(c.months.map((p) => p.month)).toEqual([2, 3, 4]);
  });

  it("finds last-year and previous windows, and reports when they do not exist", () => {
    const a = periods.findIndex((p) => p.year === 2026 && p.month === 8);
    const w = resolveWindow(periods, "ytd", a);
    expect(lastYearWindow(periods, w)!.months.every((p) => p.year === 2025)).toBe(true);
    expect(previousWindow(periods, w)!.months).toHaveLength(8);
    const early = resolveWindow(periods, "ytd", periods.findIndex((p) => p.year === 2025 && p.month === 3));
    expect(lastYearWindow(periods, early)).toBeNull();
    expect(previousWindow(periods, early)).toBeNull();
  });

  it("defaults the anchor to the latest month with human-entered IMS", () => {
    const ds = intlDataset();
    const series = buildSkuSeries(ds);
    const idx = latestActualImsIndex(series, periods, NOW);
    expect(periods[idx]).toMatchObject({ year: 2026, month: 8 });
  });
});

describe("filters and grouping", () => {
  it("applies weight / category / packaging / flavour filters", () => {
    expect(applyFilters(skus, { weights: ["50g"] }).map((s) => s.id)).toEqual([1, 3]);
    expect(applyFilters(skus, { categories: ["NPI"] }).map((s) => s.id)).toEqual([3]);
    expect(applyFilters(skus, { packaging: ["Old"] }).map((s) => s.id)).toEqual([2]);
    expect(applyFilters(skus, { flavours: ["Grape"] }).map((s) => s.id)).toEqual([2]);
    expect(flavourOf(skus[0])).toBe("Two Apples");
  });
});

describe("demand analytics", () => {
  it("computes running rates only when enough actual months exist", () => {
    expect(runningRate([100, 200, 300], 2, 3)).toBe(200);
    expect(runningRate([null, 200, 300], 2, 3)).toBeNull();
  });

  it("builds a Pareto with the 80% cut and top movers", () => {
    const rows = paretoRows([
      { sku: "A", weight: "50g", mc: 700 },
      { sku: "B", weight: "50g", mc: 200 },
      { sku: "C", weight: "50g", mc: 100 },
    ]);
    expect(rows.map((r) => r.inTop80)).toEqual([true, true, false]);
    const m = topMovers([
      { sku: "A", weight: "50g", current: 120, reference: 100 },
      { sku: "B", weight: "50g", current: 80, reference: 100 },
    ]);
    expect(m.growers[0].sku).toBe("A");
    expect(m.decliners[0].deltaPct).toBe(-20);
  });

  it("seasonality index averages to 1 across months with data", () => {
    const pts = seasonalityIndex(periods, periods.map((p) => (p.year === 2025 ? (p.month === 3 ? 200 : 100) : null)));
    const withData = pts.filter((p) => p.index !== null);
    expect(withData).toHaveLength(12);
    expect(pts[2].index).toBeGreaterThan(pts[0].index!);
    expect(pts[2].tag).toBe("Ramadan");
  });
});

describe("forecast accuracy", () => {
  it("excludes auto-filled months and computes WAPE accuracy and bias", () => {
    const ds = intlDataset();
    const series = buildSkuSeries(ds);
    const w = resolveWindow(periods, "custom", 0, "2026-07", "2026-10");
    const { samples, excludedAutoFilled } = accuracySamples(series, w);
    expect(excludedAutoFilled).toBe(6); // Sep + Oct 2026 auto-filled for 3 SKUs
    expect(samples).toHaveLength(6); // Jul + Aug 2026 actual for 3 SKUs
    const a = accuracyOf([{ forecast: 110, actual: 100 }, { forecast: 90, actual: 100 }]);
    expect(a.accuracyPct).toBe(90);
    expect(a.biasPct).toBe(0);
    expect(accuracyOf([]).accuracyPct).toBeNull();
  });

  it("flags chronic over/under forecasting after 3 consecutive months", () => {
    const ds = intlDataset();
    // Force SKU 1 to be over-forecast by 30% for Jun–Aug 2026.
    for (const p of [pid(2026, 6), pid(2026, 7), pid(2026, 8)]) {
      const f = ds.forecast.find((r) => r.skuId === 1 && r.periodId === p)!;
      const i = ds.ims.find((r) => r.skuId === 1 && r.periodId === p)!;
      i.value = "100";
      f.value = "130";
    }
    const series = buildSkuSeries(ds);
    const toIdx = periods.findIndex((p) => p.year === 2026 && p.month === 8);
    const chronic = chronicBias(series, toIdx);
    const hit = chronic.find((c) => c.sku === skus[0].name);
    expect(hit).toBeDefined();
    expect(hit!.direction).toBe("over");
    expect(hit!.consecutiveMonths).toBeGreaterThanOrEqual(3);
  });
});

describe("projection and inventory", () => {
  it("projects stock forward and finds the stock-out month", () => {
    const input = { skuId: 1, sku: "A", weight: "50g", openingStock: 100, demand: [60, 60, 60], arrivals: [0, 50, 0] };
    const p = projectSku(input, 1, coverRuleFor("Syria"));
    expect(p.map((m) => m.closing)).toEqual([40, 30, -30]);
    expect(findStockout(input, 1)).toEqual({ monthIndex: 2, dayOfMonth: 15 });
    expect(findStockout(input, 0.5)).toBeNull();
    const agg = aggregateProjection([input, { ...input, skuId: 2 }], 1, coverRuleFor("Syria"));
    expect(agg[0].closing).toBe(80);
    expect(mcForWeeks(4, [60], 0, coverRuleFor("Syria"))).toBe(60);
  });

  it("derives projection inputs from the window end, including planned arrivals for intl", () => {
    const ds = intlDataset();
    const batches = buildBatches(ds, ds.skus);
    const planned = plannedArrivalsMap(ds, ds.skus, batches);
    const series = buildSkuSeries(ds, ds.skus, planned);
    const toIdx = periods.findIndex((p) => p.year === 2026 && p.month === 8);
    const rows = projectionInputs(series, periods, toIdx, 6, true);
    expect(rows[0].labels[0]).toBe("Sep'26");
    expect(rows[0].openingStock).toBe(series[0].months[toIdx].closing);
    // Sep 2026 production with a 45-day offset lands mid-October → planned arrivals in Oct.
    expect(rows[0].arrivals[1]).toBeGreaterThan(0);
    const sf = shortfallBeforeNextArrival({ ...rows[0], openingStock: 0, demand: [100, 100], arrivals: [0, 500] });
    expect(sf.shortfall).toBe(100);
    expect(stockoutRisk({ ...rows[0], openingStock: 0, demand: [100, 100], arrivals: [0, 500] })).toEqual({ monthIndex: 0, dayOfMonth: 1 });
  });

  it("expected arrival = 1st of production month + offset", () => {
    expect(computeExpectedArrival(2026, 1, 45, "days").getMonth()).toBe(1);
    expect(computeExpectedArrival(2026, 1, 2, "months").getMonth()).toBe(2);
    expect(computeExpectedArrival(2026, 1, 6, "weeks").getDate()).toBe(12);
  });

  it("expiry risk uses FIFO at the run-rate", () => {
    const rows = [
      { skuId: 1, skuName: "A", weight: "50g", productionPeriodLabel: "Jan 2025", productionDate: "2025-01-01", expiryDate: "2027-01-01", totalRemaining: 300, monthsUntilExpiry: 3 },
      { skuId: 1, skuName: "A", weight: "50g", productionPeriodLabel: "Jun 2025", productionDate: "2025-06-01", expiryDate: "2027-06-01", totalRemaining: 300, monthsUntilExpiry: 8 },
    ];
    const out = expiryAtRisk(rows, new Map([[1, 50]]));
    // Batch 1: 300 at 50/month = 6 months, expires in 3 → 150 at risk. Batch 2 finishes at month 12, expires in 8 → 200 at risk.
    expect(out.map((r) => r.atRiskMc)).toEqual([200, 150]);
    expect(expiryAtRisk(rows, new Map())[0].atRiskMc).toBe(300);
  });

  it("total weeks of cover is computed on totals with the country rule", () => {
    const ds = intlDataset();
    const series = buildSkuSeries(ds);
    const idx = periods.findIndex((p) => p.year === 2026 && p.month === 8);
    const closing = series.reduce((t, s) => t + s.months[idx].closing, 0);
    const ims = series.reduce((t, s) => t + s.months[idx].ims, 0);
    expect(totalWeeksAt(series, idx, "Syria")).toBeCloseTo((closing / ims) * 4, 6);
  });
});

describe("RAG rules, messages and risks", () => {
  it("applies the documented thresholds", () => {
    expect(ragVsPlan(-3).status).toBe("green");
    expect(ragVsPlan(-10).status).toBe("amber");
    expect(ragVsPlan(-20).status).toBe("red");
    expect(ragVsPlan(null).status).toBe("grey");
    expect(ragCover(5, 100).status).toBe("green");
    expect(ragCover(3.5, 100).status).toBe("amber");
    expect(ragCover(7, 100).status).toBe("amber");
    expect(ragCover(2, 100).status).toBe("red");
    expect(ragCover(9, 100).status).toBe("red");
    expect(ragCover(null, 100).status).toBe("amber");
  });

  it("ranks key messages by MC impact and caps at six", () => {
    const msgs = buildKeyMessages({
      country: "Syria",
      windowLabel: "Aug 2026",
      ims: 800,
      imsPlan: 1000,
      imsLy: 700,
      production: 900,
      productionPlan: 1000,
      closing: 1200,
      weeks: 5,
      criticalSkus: [{ sku: "A", shortfall: 50 }],
      overstockSkus: [{ sku: "B", excess: 400 }],
      accuracyPct: 60,
      absForecastError: 300,
      pendingClearanceMc: 5000,
      delayedBatches: 2,
      expiryRiskMc: 10,
      monthlyDemand: 800,
    });
    expect(msgs.length).toBeLessThanOrEqual(6);
    expect(msgs.length).toBeGreaterThanOrEqual(4);
    expect(msgs[0].headline).toContain("not yet cleared");
    expect(msgs.map((m) => m.rank)).toEqual(msgs.map((_, i) => i + 1));
    for (const m of msgs) expect(m.headline).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("puts red risks first and limits to five", () => {
    const risks = buildRisks({
      atRisk: [{ sku: "A", weight: "50g", shortfall: 100, stockoutDate: "2026-10-15", nextArrival: { month: "Nov'26", mc: 500 } }],
      overstock: [
        { sku: "B", weight: "50g", excess: 900, monthsToSell: 4 },
        { sku: "C", weight: "50g", excess: 800, monthsToSell: 3 },
      ],
      delayed: [{ sku: "D", weight: "250g", pendingMc: 300, daysLate: 40, invoiceRef: "INV-1", productionPeriod: "Jun 2026" }],
      chronic: [{ sku: "E", weight: "50g", direction: "over", avgBiasPct: 25, monthlyDemand: 200 }],
      expiry: [{ sku: "F", weight: "50g", atRiskMc: 60, expiryDate: "2026-12-01" }],
    });
    expect(risks).toHaveLength(5);
    expect(risks[0].severity).toBe("red");
    expect(risks.every((r, i) => r.rank === i + 1)).toBe(true);
    expect(risks.filter((r) => r.severity === "red")).toHaveLength(3);
    expect(risks.find((r) => r.sku === "A")!.action).toContain("Pull forward");
  });

  it("confidence score drops with data issues", () => {
    expect(confidenceScore({ missingImsMonths: 0, skusWithoutForecast: 0, autoFilledPastMonths: 0, skusMissingPrice: 0, totalSkus: 10, reconciliationOk: true })).toEqual({ score: 100, grade: "High" });
    expect(confidenceScore({ missingImsMonths: 20, skusWithoutForecast: 2, autoFilledPastMonths: 3, skusMissingPrice: 5, totalSkus: 10, reconciliationOk: false }).grade).toBe("Low");
  });
});

describe("buildPack end to end", () => {
  it("builds every section for an intl country and reconciles with the reference closing stock", () => {
    const ds = intlDataset();
    const reference = ds.skus.map((s) => {
      const closings = referenceIntlClosing(ds, s.id);
      const curIdx = periods.findIndex((p) => p.year === 2026 && p.month === 9);
      return { id: s.id, name: s.name, weight: s.weight, closingStock: Math.round(closings[curIdx]) };
    });
    const pack = buildPack(ds, { country: "Syria", preset: "ytd", compare: "plan" }, reference);
    expect(pack.meta.window.to.short).toBe("Aug'26");
    expect(pack.meta.window.months).toHaveLength(8);
    expect(pack.meta.isIntl).toBe(true);
    expect(pack.executive.tiles.map((t) => t.key)).toEqual(["ims", "production", "arrivals", "closing", "cover", "accuracy", "attainment", "stockoutRisk", "overstock", "pendingClearance", "expiryRisk"]);
    for (const t of pack.executive.tiles) {
      expect(t.question.endsWith("?")).toBe(true);
      if (t.key !== "expiryRisk") expect(t.sparkline).toHaveLength(12);
    }
    expect(pack.confidence.reconciliation.ok).toBe(true);
    expect(pack.confidence.reconciliation.checkedSkus).toBe(3);
    expect(pack.flow.waterfall.supply[0].key).toBe("plan");
    expect(pack.flow.waterfall.stock.at(-1)!.value).toBe(pack.executive.tiles.find((t) => t.key === "closing")!.value);
    expect(pack.demand.monthly).toHaveLength(8);
    expect(pack.demand.yoy).toHaveLength(8);
    expect(pack.supply.clearance).not.toBeNull();
    expect(pack.inventory.heatmap.months).toHaveLength(4); // Sep–Dec 2026 exist in the fixture
    expect(pack.forward.horizonMonths).toEqual(["Sep'26", "Oct'26", "Nov'26", "Dec'26"]);
    expect(pack.forward.inputs.skus).toHaveLength(3);
    expect(pack.commercial.hasPrices).toBe(true);
    expect(pack.commercial.skusMissingPrice).toEqual([skus[1].name]);
    expect(pack.confidence.score).toBeGreaterThan(0);
  });

  it("reports a reconciliation mismatch instead of hiding it", () => {
    const ds = intlDataset();
    const pack = buildPack(ds, { country: "Syria", preset: "month", compare: "ly" }, [{ id: 1, name: skus[0].name, weight: "50g", closingStock: 999999 }]);
    expect(pack.confidence.reconciliation.ok).toBe(false);
    expect(pack.confidence.reconciliation.mismatches).toHaveLength(1);
    expect(pack.confidence.issues.some((i) => i.title.includes("reconcile"))).toBe(true);
  });

  it("builds a Lebanon pack without intl-only sections and hides dollar values when no prices exist", () => {
    const ds = lebanonDataset();
    ds.skus = ds.skus.map((s) => ({ ...s, priceToWs: null }));
    const pack = buildPack(ds, { country: "Lebanon", preset: "month", compare: "prev" }, null);
    expect(pack.meta.isIntl).toBe(false);
    expect(pack.executive.tiles.some((t) => t.key === "pendingClearance")).toBe(false);
    expect(pack.inventory.expiryRisk).toBeNull();
    expect(pack.supply.clearance).toBeNull();
    expect(pack.commercial.hasPrices).toBe(false);
    expect(pack.commercial.selloutUsd).toBeNull();
    expect(pack.inventory.stockValue.valueUsd).toBeNull();
    expect(pack.flow.delayedBatches).toEqual([]);
  });

  it("respects filters and reports empty states for missing prior-year data", () => {
    const ds = intlDataset();
    const early = buildPack(ds, { country: "Syria", preset: "qtd", anchor: "2025-02", compare: "ly", filters: { weights: ["250g"] } }, null);
    expect(early.meta.skuCount).toBe(1);
    expect(early.meta.lastYearAvailable).toBe(false);
    const imsTile = early.executive.tiles.find((t) => t.key === "ims")!;
    expect(imsTile.vsLastYear?.note).toBe("No prior year data");
    expect(early.demand.notes).toContain("No prior year data for year-on-year comparison.");
  });
});
