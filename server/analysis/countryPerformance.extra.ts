/**
 * Board-pack additions: Running Rate strip, Full-Year Outlook, Volume Bridge,
 * Portfolio Health, Lost Sales, Inventory Efficiency, Market Context,
 * Anomalies and the frozen Board Headline.
 *
 * Everything here is a pure function of the dataset-derived SKU series so it
 * can be unit tested without a database. Quantities are MC.
 */
import type { CoverRule } from "../../shared/performance/projection";
import { coverRuleFor, weeksOfCoverAt } from "../../shared/performance/projection";
import type {
  AnomalyRow,
  AnomalySection,
  BoardHeadline,
  BridgeStep,
  EfficiencyGroup,
  EfficiencyPoint,
  FlavourRank,
  InventoryEfficiency,
  LostSales,
  LostSalesRow,
  MarketBrandRow,
  MarketPoint,
  MarketSection,
  OutlookBaseline,
  OutlookGroup,
  OutlookMonth,
  OutlookSection,
  PerformanceCountry,
  PortfolioPoint,
  PortfolioSection,
  Quadrant,
  Rag,
  RateFigure,
  RunningRateChartPoint,
  RunningRateDriver,
  RunningRateSection,
  RunningRateTile,
  TailRow,
  VariabilityRow,
  VolumeBridge,
} from "./countryPerformance.types";
import {
  flavourOf,
  isIntlCountry,
  pct,
  ragCover,
  ragVsPlan,
  round,
  shortLabel,
  sum,
  type DatasetPeriod,
  type DatasetSku,
  type SkuSeries,
  type ValueRow,
  type Window,
} from "./countryPerformance.helpers";

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const fmtPct = (v: number | null, digits = 0) => (v === null ? "n/a" : `${Math.abs(v).toFixed(digits)}%`);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const isNpi = (sku: DatasetSku) => (sku.category ?? "Core") !== "Core";
const typeOf = (sku: DatasetSku) => (isNpi(sku) ? "NPI" : "Core");

function weeksPerMonth(rule: CoverRule): number {
  return rule.factor;
}

// ── Running Rate (same method as the Running Rate tab) ───────────────────────

/**
 * Per-SKU running rate exactly as the Running Rate tab computes it:
 * anchor on the SKU's own last month with sales (not after `endIdx`), average
 * only the months with sales inside the last 3 / 6, round per SKU.
 */
export function tabRunningRate(values: number[], endIdx: number): { avg3: number; avg6: number; prior3: number; last: number; lastIdx: number } {
  const end = Math.min(endIdx, values.length - 1);
  let lastDataIdx = end;
  for (let i = end; i >= 0; i--) {
    if (values[i] > 0) {
      lastDataIdx = i;
      break;
    }
  }
  const recent = values.slice(0, lastDataIdx + 1);
  const nz = (xs: number[]) => xs.filter((v) => v > 0);
  const avg3 = Math.round(avg(nz(recent.slice(-3))));
  const avg6 = Math.round(avg(nz(recent.slice(-6))));
  const prior3 = Math.round(avg(nz(recent.slice(-6, -3))));
  return { avg3, avg6, prior3, last: recent.length ? Math.round(recent[recent.length - 1]) : 0, lastIdx: lastDataIdx };
}

/** Raw IMS per period for the running rate: human-entered months only (auto-filled → 0). */
export function actualImsValues(s: SkuSeries): number[] {
  return s.months.map((c) => (c.imsIsActual ? c.ims : 0));
}

function rateFigure(label: string, value: number | null, plan: number | null, lastYear: number | null): RateFigure {
  const vsPlanPct = value !== null && plan !== null && plan > 0 ? pct(value, plan) : null;
  const vsLyPct = value !== null && lastYear !== null && lastYear > 0 ? pct(value, lastYear) : null;
  const rag = ragVsPlan(vsPlanPct);
  return { label, value, plan, lastYear, vsPlanPct, vsLyPct, status: value === null ? "grey" : rag.status, statusReason: value === null ? "No actual IMS yet" : rag.reason };
}

function avgOverIdx(values: (number | null)[], toIdx: number, n: number): number | null {
  const from = toIdx - n + 1;
  if (from < 0) return null;
  let total = 0;
  for (let i = from; i <= toIdx; i++) total += values[i] ?? 0;
  return total / n;
}

export function buildRunningRate(a: {
  country: PerformanceCountry;
  series: SkuSeries[];
  periods: DatasetPeriod[];
  w: Window;
  latestActualIdx: number;
  mPlan: number[];
  mIms: number[];
  mImsActual: (number | null)[];
  rule: CoverRule;
}): RunningRateSection {
  const { series, periods, w, mPlan, mIms, mImsActual, rule } = a;
  const notes: string[] = [];
  const method = "Same method as the Running Rate tab: each SKU is averaged over its last 3 (or 6) months with sales, then SKUs are added up. Auto-filled IMS months are excluded.";
  const empty = (): RunningRateSection => ({
    asOf: null,
    headline: rateFigure("Latest month", null, null, null),
    avg3: rateFigure("3-month average", null, null, null),
    avg6: rateFigure("6-month average", null, null, null),
    annualised: null,
    closingStock: 0,
    coverWeeks: null,
    coverStatus: "grey",
    coverReason: "No actual IMS in this period",
    target: { low: 4, high: 6 },
    trend: { pct: null, direction: "unknown", text: "No actual IMS in this period to measure a run rate" },
    chart: [],
    byWeight: [],
    byType: [],
    up: [],
    down: [],
    message: "No actual IMS has been entered for this period, so there is no running rate to show.",
    method,
    notes,
  });

  // Anchor: latest month with actual IMS at or before the window end.
  let idx = -1;
  for (let i = Math.min(w.toIdx, periods.length - 1); i >= 0; i--) {
    if (mImsActual[i] !== null) {
      idx = i;
      break;
    }
  }
  if (idx < 0 || series.length === 0) return empty();
  const asOf = periods[idx].label;
  if (idx < a.latestActualIdx) notes.push(`Measured at ${asOf}, the latest month with actual IMS inside the selected period.`);

  const perSku = series.map((s) => {
    const values = actualImsValues(s);
    const r = tabRunningRate(values, idx);
    return { s, values, ...r };
  });

  const lyIdx = idx - 12 >= 0 ? idx - 12 : -1;
  const lyValue = (i: number) => (i >= 0 ? mIms[i] : null);

  const headlineValue = mImsActual[idx] ?? 0;
  const headline = rateFigure("Latest month", round(headlineValue), round(mPlan[idx]), lyValue(lyIdx));
  const avg3Total = sum(perSku.map((p) => p.avg3));
  const avg6Total = sum(perSku.map((p) => p.avg6));
  const prior3Total = sum(perSku.map((p) => p.prior3));
  const plan3 = avgOverIdx(mPlan, idx, 3);
  const plan6 = avgOverIdx(mPlan, idx, 6);
  const ly3 = lyIdx >= 0 ? avgOverIdx(mIms, lyIdx, 3) : null;
  const ly6 = lyIdx >= 0 ? avgOverIdx(mIms, lyIdx, 6) : null;
  const avg3 = rateFigure("3-month average", avg3Total, plan3 === null ? null : round(plan3), ly3 === null ? null : round(ly3));
  const avg6 = rateFigure("6-month average", avg6Total, plan6 === null ? null : round(plan6), ly6 === null ? null : round(ly6));

  // Cover at the current rate.
  const closingStock = sum(series.map((s) => s.months[idx].closing));
  const coverWeeks = headlineValue > 0 ? round((closingStock / headlineValue) * weeksPerMonth(rule), 1) : null;
  const cover = ragCover(coverWeeks, closingStock);

  // Trend: 3-month average vs the previous 3 months (tab method).
  const trendPct = prior3Total > 0 ? round(((avg3Total - prior3Total) / prior3Total) * 100, 1) : null;
  const direction: RunningRateSection["trend"]["direction"] = trendPct === null ? "unknown" : trendPct > 2 ? "up" : trendPct < -2 ? "down" : "flat";
  const trendText =
    trendPct === null
      ? "Not enough history to compare with 3 months ago"
      : direction === "flat"
        ? `Run rate flat vs 3 months ago (${trendPct > 0 ? "+" : ""}${trendPct.toFixed(1)}%)`
        : `Run rate ${direction} ${fmtPct(trendPct, 1)} vs 3 months ago`;

  // 24-month chart.
  const chart: RunningRateChartPoint[] = [];
  const start = Math.max(0, idx - 23);
  const imsActualOrNull = (i: number) => (mImsActual[i] === null ? null : round(mImsActual[i] as number));
  for (let i = start; i <= idx; i++) {
    const r3 = avgOverIdx(mImsActual.map((v) => v ?? 0), i, 3);
    const r6 = avgOverIdx(mImsActual.map((v) => v ?? 0), i, 6);
    const hasFull3 = i - 2 >= 0 && [i, i - 1, i - 2].every((k) => mImsActual[k] !== null);
    const hasFull6 = i - 5 >= 0 && [0, 1, 2, 3, 4, 5].every((d) => mImsActual[i - d] !== null);
    chart.push({
      label: shortLabel(periods[i]),
      ims: imsActualOrNull(i),
      rate3: hasFull3 && r3 !== null ? round(r3) : null,
      rate6: hasFull6 && r6 !== null ? round(r6) : null,
      plan: round(mPlan[i]),
      lastYear: i - 12 >= 0 ? round(mIms[i - 12]) : null,
      isActual: mImsActual[i] !== null,
    });
  }

  // Group tiles: sum of per-SKU 3-month averages vs plan / LY averages over the same 3 calendar months.
  const tile = (group: string, members: typeof perSku): RunningRateTile => {
    const current = sum(members.map((m) => m.avg3));
    const planAvg = idx - 2 >= 0 ? avg([0, 1, 2].map((d) => sum(members.map((m) => m.s.months[idx - d].forecast)))) : null;
    const lyAvg = lyIdx - 2 >= 0 ? avg([0, 1, 2].map((d) => sum(members.map((m) => m.s.months[lyIdx - d].ims)))) : null;
    const vsPlanPct = planAvg !== null && planAvg > 0 ? pct(current, planAvg) : null;
    const vsLyPct = lyAvg !== null && lyAvg > 0 ? pct(current, lyAvg) : null;
    return { group, current, plan: planAvg === null ? null : round(planAvg), lastYear: lyAvg === null ? null : round(lyAvg), vsPlanPct, vsLyPct, status: ragVsPlan(vsPlanPct).status, skuCount: members.length };
  };
  const weights = Array.from(new Set(series.map((s) => s.sku.weight))).sort((x, y) => gramsOf(x) - gramsOf(y));
  const byWeight = weights.map((wt) => tile(wt, perSku.filter((p) => p.s.sku.weight === wt)));
  const byType = ["Core", "NPI"].map((t) => tile(t, perSku.filter((p) => typeOf(p.s.sku) === t))).filter((t) => t.skuCount > 0);

  // Drivers of the change in run rate (3-month avg vs previous 3 months, per SKU).
  const drivers: RunningRateDriver[] = perSku
    .map((p) => ({ sku: p.s.sku.name, weight: p.s.sku.weight, current: p.avg3, previous: p.prior3, changeMc: p.avg3 - p.prior3, changePct: p.prior3 > 0 ? pct(p.avg3, p.prior3) : null }))
    .filter((d) => d.changeMc !== 0);
  const up = drivers.filter((d) => d.changeMc > 0).sort((x, y) => y.changeMc - x.changeMc).slice(0, 5);
  const down = drivers.filter((d) => d.changeMc < 0).sort((x, y) => x.changeMc - y.changeMc).slice(0, 5);

  const annualised = round(headlineValue * 12);
  const vsPlanTxt = headline.vsPlanPct === null ? "no plan to compare" : `${fmtPct(headline.vsPlanPct)} ${headline.vsPlanPct >= 0 ? "above" : "below"} plan`;
  const vsLyTxt = headline.vsLyPct === null ? "no prior-year data" : `${fmtPct(headline.vsLyPct)} ${headline.vsLyPct >= 0 ? "above" : "below"} last year`;
  const coverTxt = coverWeeks === null ? "cover cannot be measured" : `at this rate current stock covers ${coverWeeks.toFixed(1)} weeks`;
  const message = `The market is running at ${fmt(headlineValue)} MC/month (${asOf}), ${vsPlanTxt} and ${vsLyTxt}; ${coverTxt}.`;

  return {
    asOf,
    headline,
    avg3,
    avg6,
    annualised,
    closingStock: round(closingStock),
    coverWeeks,
    coverStatus: cover.status,
    coverReason: cover.reason,
    target: { low: 4, high: 6 },
    trend: { pct: trendPct, direction, text: trendText },
    chart,
    byWeight,
    byType,
    up,
    down,
    message,
    method,
    notes,
  };
}

export function gramsOf(weight: string): number {
  const m = /([\d.]+)\s*(kg|g)/i.exec(weight);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = parseFloat(m[1]);
  return m[2].toLowerCase() === "kg" ? n * 1000 : n;
}

// ── Full-year outlook & required run rate ────────────────────────────────────

export interface BudgetBaseline {
  versionId: number;
  versionName: string;
  savedAt: string | null;
  /** Forecast MC keyed by `${skuName}|${weight}|${year}-${month}`. */
  forecast: Map<string, number>;
}

export const baselineKey = (skuName: string, weight: string, year: number, month: number) => `${skuName}|${weight}|${year}-${month}`;

/** Reads a saved version's snapshot into a baseline forecast map (skus/periods matched by name, not id). */
export function baselineFromSnapshot(version: { id: number; name: string; createdAt: Date | string | null; snapshotData: unknown }): BudgetBaseline {
  const snap = (version.snapshotData ?? {}) as { skus?: { id: number; name: string; weight: string }[]; periods?: { id: number; year: number; month: number }[]; forecast?: ValueRow[] };
  const skuById = new Map((snap.skus ?? []).map((s) => [s.id, s]));
  const periodById = new Map((snap.periods ?? []).map((p) => [p.id, p]));
  const forecast = new Map<string, number>();
  for (const f of snap.forecast ?? []) {
    const s = skuById.get(f.skuId);
    const p = periodById.get(f.periodId);
    if (!s || !p) continue;
    const k = baselineKey(s.name, s.weight, p.year, p.month);
    forecast.set(k, (forecast.get(k) ?? 0) + (parseFloat(String(f.value ?? "0")) || 0));
  }
  const savedAt = version.createdAt ? new Date(version.createdAt).toISOString() : null;
  return { versionId: version.id, versionName: version.name, savedAt, forecast };
}

export function buildOutlook(a: {
  series: SkuSeries[];
  periods: DatasetPeriod[];
  w: Window;
  latestActualIdx: number;
  mImsActual: (number | null)[];
  baseline: BudgetBaseline | null;
  currentRate: number | null;
  rule: CoverRule;
}): OutlookSection {
  const { series, periods, w, mImsActual, baseline } = a;
  const notes: string[] = [];
  const year = periods[w.toIdx].year;
  const yearIdx = periods.map((p, i) => (p.year === year ? i : -1)).filter((i) => i >= 0);
  // "Through" = latest month with actual IMS inside the year and not after the window end.
  let throughIdx = -1;
  for (const i of yearIdx) if (i <= w.toIdx && mImsActual[i] !== null) throughIdx = i;
  const monthsElapsed = throughIdx >= 0 ? periods[throughIdx].month : 0;
  const monthsRemaining = 12 - monthsElapsed;
  const missing = 12 - yearIdx.length;
  if (missing > 0) notes.push(`${missing} month${missing === 1 ? "" : "s"} of ${year} are not in the planning horizon yet; the landing estimate only covers the months that exist.`);

  const baselineInfo: OutlookBaseline = baseline
    ? { kind: "version", label: `Budget: ${baseline.versionName}`, versionId: baseline.versionId, versionName: baseline.versionName, savedAt: baseline.savedAt, note: `Annual plan taken from the saved version "${baseline.versionName}" chosen as the board-approved plan for ${year}.` }
    : { kind: "current", label: "Current forecast (no approved budget chosen)", versionId: null, versionName: null, savedAt: null, note: `No saved version has been chosen as the ${year} budget, so the annual plan is today's forecast. An admin can pick a version in the Full-Year Outlook settings.` };

  const planFor = (s: SkuSeries, i: number): number | null => {
    if (!baseline) return s.months[i].forecast;
    const v = baseline.forecast.get(baselineKey(s.sku.name, s.sku.weight, periods[i].year, periods[i].month));
    return v ?? 0;
  };

  const group = (name: string, members: SkuSeries[]): OutlookGroup => {
    let ytdActual = 0;
    let remainingForecast = 0;
    let annualPlan = 0;
    for (const s of members) {
      for (const i of yearIdx) {
        const c = s.months[i];
        if (i <= throughIdx) ytdActual += c.imsIsActual ? c.ims : 0;
        else remainingForecast += c.forecast;
        annualPlan += planFor(s, i) ?? 0;
      }
    }
    const landing = ytdActual + remainingForecast;
    const gapMc = round(landing - annualPlan);
    const gapPct = annualPlan > 0 ? pct(landing, annualPlan) : null;
    const requiredRate = monthsRemaining > 0 ? round(Math.max(0, annualPlan - ytdActual) / monthsRemaining) : null;
    const currentRate = round(sum(members.map((s) => (throughIdx >= 0 ? (s.months[throughIdx].imsIsActual ? s.months[throughIdx].ims : 0) : 0))));
    const stretchPct = requiredRate !== null && currentRate > 0 ? round(((requiredRate - currentRate) / currentRate) * 100, 1) : null;
    const rag = ragVsPlan(gapPct);
    return { group: name, ytdActual: round(ytdActual), remainingForecast: round(remainingForecast), landing: round(landing), annualPlan: round(annualPlan), gapMc, gapPct, requiredRate, currentRate, stretchPct, status: annualPlan > 0 ? rag.status : "grey", skuCount: members.length };
  };

  const total = group("Total", series);
  const weights = Array.from(new Set(series.map((s) => s.sku.weight))).sort((x, y) => gramsOf(x) - gramsOf(y));
  const byWeight = weights.map((wt) => group(wt, series.filter((s) => s.sku.weight === wt)));
  const byType = ["Core", "NPI"].map((t) => group(t, series.filter((s) => typeOf(s.sku) === t))).filter((g) => g.skuCount > 0);

  let cumLanding = 0;
  let cumPlan = 0;
  const monthly: OutlookMonth[] = yearIdx.map((i) => {
    const actual = i <= throughIdx ? round(sum(series.map((s) => (s.months[i].imsIsActual ? s.months[i].ims : 0)))) : null;
    const forecast = round(sum(series.map((s) => s.months[i].forecast)));
    const plan = round(sum(series.map((s) => planFor(s, i) ?? 0)));
    cumLanding += actual ?? forecast;
    cumPlan += plan;
    return { label: shortLabel(periods[i]), actual, forecast, plan, cumulativeLanding: round(cumLanding), cumulativePlan: round(cumPlan) };
  });

  const ytdThrough = throughIdx >= 0 ? periods[throughIdx].label : null;
  let message: string;
  if (throughIdx < 0) message = `No actual IMS has been entered for ${year} yet, so the landing estimate is the full forecast (${fmt(total.landing)} MC).`;
  else if (total.annualPlan === null || total.annualPlan === 0) message = `${year} is heading for ${fmt(total.landing)} MC (actual to ${ytdThrough} plus forecast). No annual plan is available to compare against.`;
  else {
    const gapWord = (total.gapMc ?? 0) >= 0 ? "above" : "below";
    const stretch = total.requiredRate === null ? "" : total.stretchPct === null ? ` We need ${fmt(total.requiredRate)} MC/month for the rest of the year.` : ` We need ${fmt(total.requiredRate)} MC/month for the rest of the year vs ${fmt(total.currentRate)} today, a ${fmtPct(total.stretchPct)} ${total.stretchPct >= 0 ? "stretch" : "cushion"}.`;
    message = `${year} is heading for ${fmt(total.landing)} MC, ${fmtPct(total.gapPct, 1)} ${gapWord} the annual plan of ${fmt(total.annualPlan)} MC.${stretch}`;
  }
  notes.push("Landing estimate = actual IMS to date plus the current forecast for the remaining months. Required run rate = (annual plan − actual to date) ÷ months remaining, compared with the latest actual month.");

  return { year, ytdThrough, monthsElapsed, monthsRemaining, baseline: baselineInfo, total, byWeight, byType, monthly, message, notes };
}

// ── Volume bridge ────────────────────────────────────────────────────────────

export function buildVolumeBridge(a: {
  series: SkuSeries[];
  periods: DatasetPeriod[];
  w: Window;
  lyW: Window | null;
  inactive: { sku: DatasetSku; ims: number[] }[];
  windowLabel: string;
  lyLabel: string | null;
}): VolumeBridge {
  const { series, w, lyW, inactive } = a;
  if (!lyW) {
    return { available: false, fromLabel: "Last year", toLabel: a.windowLabel, steps: [], byWeight: [], note: "No prior-year data, so the bridge cannot be built." };
  }
  const sumWin = (vals: number[], win: Window) => {
    let t = 0;
    for (let i = win.fromIdx; i <= win.toIdx; i++) t += vals[i] ?? 0;
    return t;
  };
  const lyTotalActive = sum(series.map((s) => sumWin(s.months.map((c) => c.ims), lyW)));
  const lyLost = sum(inactive.map((x) => sumWin(x.ims, lyW)));
  const lyTotal = lyTotalActive + lyLost;
  const tyTotal = sum(series.map((s) => sumWin(s.months.map((c) => c.ims), w)));

  let coreGrowth = 0;
  let npiLaunch = 0;
  const byWeightMap = new Map<string, number>();
  for (const s of series) {
    const ly = sumWin(s.months.map((c) => c.ims), lyW);
    const ty = sumWin(s.months.map((c) => c.ims), w);
    const d = ty - ly;
    const newThisYear = ly === 0 && ty > 0;
    if (isNpi(s.sku) || newThisYear) npiLaunch += d;
    else coreGrowth += d;
    byWeightMap.set(s.sku.weight, (byWeightMap.get(s.sku.weight) ?? 0) + d);
  }
  for (const x of inactive) {
    const ly = sumWin(x.ims, lyW);
    byWeightMap.set(x.sku.weight, (byWeightMap.get(x.sku.weight) ?? 0) - ly);
  }
  const steps: BridgeStep[] = [
    { key: "ly", label: `Last year (${a.lyLabel ?? "same months"})`, value: round(lyTotal), kind: "total" },
    { key: "core", label: "Core growth / decline", value: round(coreGrowth), kind: "delta", detail: "Change on SKUs that sold in both periods" },
    { key: "npi", label: "NPI launches", value: round(npiLaunch), kind: "delta", detail: "NPI SKUs and SKUs with no sales last year" },
    { key: "lost", label: "Discontinued / inactive SKUs", value: round(-lyLost), kind: "delta", detail: `${inactive.filter((x) => sumWin(x.ims, lyW) > 0).length} inactive SKUs sold last year` },
    { key: "ty", label: `This period (${a.windowLabel})`, value: round(tyTotal), kind: "total" },
  ];
  const byWeight: BridgeStep[] = [
    { key: "ly", label: "Last year", value: round(lyTotal), kind: "total" },
    ...Array.from(byWeightMap.entries())
      .sort((x, y) => gramsOf(x[0]) - gramsOf(y[0]))
      .map(([wt, d]) => ({ key: `w-${wt}`, label: wt, value: round(d), kind: "delta" as const })),
    { key: "ty", label: "This period", value: round(tyTotal), kind: "total" },
  ];
  const note = lyW.months.length < w.months.length ? `Partial prior-year data (${lyW.months.length} of ${w.months.length} months).` : "Bridge uses IMS as entered (auto-filled months included, as in Planning FG).";
  return { available: true, fromLabel: a.lyLabel ?? "Last year", toLabel: a.windowLabel, steps, byWeight, note };
}

// ── Portfolio health ─────────────────────────────────────────────────────────

export function buildPortfolio(a: { series: SkuSeries[]; periods: DatasetPeriod[]; w: Window; lyW: Window | null; prevW: Window | null; rule: CoverRule }): PortfolioSection {
  const { series, w, lyW, prevW } = a;
  const notes: string[] = [];
  const ref = lyW ?? prevW;
  const basis = lyW ? "Growth vs the same months last year" : prevW ? "Growth vs the previous period (no prior-year data)" : "No reference period for growth";
  const sumWin = (s: SkuSeries, win: Window | null) => (win ? sum(s.months.slice(win.fromIdx, win.toIdx + 1).map((c) => c.ims)) : null);
  const total = sum(series.map((s) => sumWin(s, w) ?? 0));
  const thresholds = { shareSplitPct: 0, growthSplitPct: 0, tailSharePct: 1 };
  const shares = series.map((s) => (total > 0 ? ((sumWin(s, w) ?? 0) / total) * 100 : 0));
  // Share split = median share of SKUs that sold; growth split = 0%.
  const sold = shares.filter((x) => x > 0).sort((x, y) => x - y);
  thresholds.shareSplitPct = sold.length ? round(sold[Math.floor(sold.length / 2)], 2) : 0;

  const points: PortfolioPoint[] = series.map((s, i) => {
    const mc = sumWin(s, w) ?? 0;
    const refMc = sumWin(s, ref);
    const growthPct = refMc !== null && refMc > 0 ? pct(mc, refMc) : null;
    const sharePct = round(shares[i], 2);
    let quadrant: Quadrant;
    if (sharePct < thresholds.tailSharePct) quadrant = "Tail";
    else if (sharePct >= thresholds.shareSplitPct) quadrant = growthPct !== null && growthPct > thresholds.growthSplitPct ? "Stars" : "Core earners";
    else quadrant = growthPct !== null && growthPct > thresholds.growthSplitPct ? "Question marks" : "Tail";
    return { sku: s.sku.name, weight: s.sku.weight, flavour: flavourOf(s.sku), category: s.sku.category ?? "Core", mc: round(mc), sharePct, growthPct, quadrant, closingStock: round(s.months[w.toIdx].closing) };
  });
  const quadrants: Quadrant[] = ["Stars", "Core earners", "Question marks", "Tail"];
  const quadrantCounts = quadrants.map((q) => {
    const ps = points.filter((p) => p.quadrant === q);
    const mc = sum(ps.map((p) => p.mc));
    return { quadrant: q, count: ps.length, mc: round(mc), sharePct: total > 0 ? round((mc / total) * 100, 1) : 0 };
  });

  // Tail report.
  const tail: TailRow[] = [];
  for (let i = 0; i < series.length; i++) {
    if (shares[i] >= thresholds.tailSharePct) continue;
    const s = series[i];
    const last3 = [0, 1, 2].map((d) => w.toIdx - d).filter((k) => k >= 0);
    const zeroMonthsLast3 = last3.filter((k) => !(s.months[k].imsIsActual && s.months[k].ims > 0)).length;
    const meaningful = Math.max(1, avg(s.months.slice(0, w.toIdx + 1).map((c) => c.ims).filter((v) => v > 0)) * 0.25);
    let monthsSinceLastSale: number | null = null;
    for (let k = w.toIdx; k >= 0; k--) {
      if (s.months[k].imsIsActual && s.months[k].ims >= meaningful) {
        monthsSinceLastSale = w.toIdx - k;
        break;
      }
    }
    const stockMc = s.months[w.toIdx].closing;
    const weeks = s.months[w.toIdx].weeks;
    const candidate = zeroMonthsLast3 >= 2 || (monthsSinceLastSale !== null && monthsSinceLastSale >= 3) || monthsSinceLastSale === null;
    const reason = monthsSinceLastSale === null ? "No meaningful sale on record" : zeroMonthsLast3 >= 2 ? `${zeroMonthsLast3} of the last 3 months without sales` : monthsSinceLastSale >= 3 ? `Last meaningful sale ${monthsSinceLastSale} months ago` : "Low volume but still selling";
    tail.push({ sku: s.sku.name, weight: s.sku.weight, mc: round(sumWin(s, w) ?? 0), sharePct: round(shares[i], 2), zeroMonthsLast3, monthsSinceLastSale, stockMc: round(stockMc), weeks, candidate, reason });
  }
  tail.sort((x, y) => Number(y.candidate) - Number(x.candidate) || y.stockMc - x.stockMc);
  const tailStockMc = round(sum(tail.map((t) => t.stockMc)));
  const candidates = tail.filter((t) => t.candidate).length;

  // Flavour ranking with movement.
  const byFlavour = new Map<string, { mc: number; ly: number | null }>();
  for (const s of series) {
    const f = flavourOf(s.sku);
    const e = byFlavour.get(f) ?? { mc: 0, ly: ref ? 0 : null };
    e.mc += sumWin(s, w) ?? 0;
    if (ref) e.ly = (e.ly ?? 0) + (sumWin(s, ref) ?? 0);
    byFlavour.set(f, e);
  }
  const ranked = Array.from(byFlavour.entries()).sort((x, y) => y[1].mc - x[1].mc);
  const lyRanked = ref ? Array.from(byFlavour.entries()).sort((x, y) => (y[1].ly ?? 0) - (x[1].ly ?? 0)).map((e) => e[0]) : null;
  const flavours: FlavourRank[] = ranked.map(([flavour, e], i) => {
    const rank = i + 1;
    const lastYearRank = lyRanked && e.ly && e.ly > 0 ? lyRanked.indexOf(flavour) + 1 : null;
    const movement = lastYearRank === null ? "new" : lastYearRank === rank ? "=" : lastYearRank > rank ? `up ${lastYearRank - rank}` : `down ${rank - lastYearRank}`;
    return { flavour, rank, lastYearRank, movement, mc: round(e.mc), lastYearMc: e.ly === null ? null : round(e.ly), growthPct: e.ly && e.ly > 0 ? pct(e.mc, e.ly) : null, sharePct: total > 0 ? round((e.mc / total) * 100, 1) : 0 };
  });

  notes.push(`Quadrants: share split at the median SKU share (${thresholds.shareSplitPct}%), growth split at 0%. Tail = under ${thresholds.tailSharePct}% of volume.`);
  notes.push("Rationalisation candidates: tail SKUs with 2+ of the last 3 months without sales, or no meaningful sale for 3+ months. A meaningful sale is at least a quarter of the SKU's average selling month.");
  return { thresholds, points, quadrantCounts, tail, tailStockMc, candidates, flavours, basis, notes };
}

// ── Lost sales & stock-out history ───────────────────────────────────────────

export function buildLostSales(a: { series: SkuSeries[]; periods: DatasetPeriod[]; w: Window; latestActualIdx: number }): LostSales {
  const { series, periods, w } = a;
  const endIdx = Math.min(w.toIdx, a.latestActualIdx);
  const start = Math.max(0, endIdx - 11);
  const rows: LostSalesRow[] = [];
  let skuMonths = 0;
  let stockoutMonths = 0;
  for (const s of series) {
    for (let i = start; i <= endIdx; i++) {
      const c = s.months[i];
      const inScope = c.imsIsActual || c.demand > 0 || c.closing !== 0;
      if (!inScope) continue;
      skuMonths++;
      if (c.closing > 0) continue;
      stockoutMonths++;
      // Run rate = average of the previous 3 months with actual sales.
      const prior: number[] = [];
      for (let k = i - 1; k >= 0 && prior.length < 3; k--) if (s.months[k].imsIsActual && s.months[k].ims > 0) prior.push(s.months[k].ims);
      const runRate = prior.length ? avg(prior) : 0;
      const ims = c.imsIsActual ? c.ims : 0;
      const lostMc = Math.max(0, runRate - ims);
      rows.push({ sku: s.sku.name, weight: s.sku.weight, month: shortLabel(periods[i]), closing: round(c.closing), ims: round(ims), runRate: round(runRate), lostMc: round(lostMc) });
    }
  }
  const bySkuMap = new Map<string, { sku: string; weight: string; months: number; lostMc: number }>();
  for (const r of rows) {
    const e = bySkuMap.get(r.sku) ?? { sku: r.sku, weight: r.weight, months: 0, lostMc: 0 };
    e.months++;
    e.lostMc += r.lostMc;
    bySkuMap.set(r.sku, e);
  }
  const bySku = Array.from(bySkuMap.values()).sort((x, y) => y.lostMc - x.lostMc);
  return {
    serviceLevelPct: skuMonths > 0 ? round(((skuMonths - stockoutMonths) / skuMonths) * 100, 1) : null,
    skuMonths,
    stockoutMonths,
    lostMc: round(sum(rows.map((r) => r.lostMc))),
    rows: rows.sort((x, y) => y.lostMc - x.lostMc),
    bySku,
    method: "Last 12 months with actual IMS. A stock-out month is one where the SKU closed at zero or below. Lost sales = the SKU's run rate (average of its previous 3 selling months) minus what it actually sold that month.",
  };
}

// ── Inventory efficiency ─────────────────────────────────────────────────────

export function buildEfficiency(a: { series: SkuSeries[]; periods: DatasetPeriod[]; w: Window; latestActualIdx: number; rule: CoverRule }): InventoryEfficiency {
  const { series, periods, w, rule } = a;
  const endIdx = Math.min(w.toIdx, a.latestActualIdx);
  const start = Math.max(0, endIdx - 11);
  const group = (name: string, members: SkuSeries[]): EfficiencyGroup => {
    const trend: EfficiencyPoint[] = [];
    for (let i = start; i <= endIdx; i++) {
      const stock = sum(members.map((m) => m.months[i].closing));
      const ims = sum(members.map((m) => (m.months[i].imsIsActual ? m.months[i].ims : 0)));
      trend.push({ label: shortLabel(periods[i]), stock: round(stock), ims: round(ims), stockToSales: ims > 0 ? round(stock / ims, 2) : null });
    }
    const months = trend.length;
    const avgStock = months ? avg(trend.map((t) => t.stock)) : 0;
    const annualisedIms = months ? (sum(trend.map((t) => t.ims)) / months) * 12 : 0;
    const turns = avgStock > 0 && annualisedIms > 0 ? round(annualisedIms / avgStock, 1) : null;
    const daysOfInventory = turns ? round(365 / turns) : null;
    return { group: name, turns, daysOfInventory, avgStock: round(avgStock), annualisedIms: round(annualisedIms), trend };
  };
  const weights = Array.from(new Set(series.map((s) => s.sku.weight))).sort((x, y) => gramsOf(x) - gramsOf(y));
  const total = group("Total", series);
  const byWeight = weights.map((wt) => group(wt, series.filter((s) => s.sku.weight === wt)));

  const variability: VariabilityRow[] = series.map((s) => {
    const vals: number[] = [];
    for (let i = start; i <= endIdx; i++) if (s.months[i].imsIsActual) vals.push(s.months[i].ims);
    const mean = vals.length ? avg(vals) : 0;
    const sd = vals.length > 1 ? Math.sqrt(sum(vals.map((v) => (v - mean) ** 2)) / (vals.length - 1)) : 0;
    const cv = vals.length >= 3 && mean > 0 ? round(sd / mean, 2) : null;
    const volatility: VariabilityRow["volatility"] = cv === null ? "Unknown" : cv < 0.25 ? "Low" : cv < 0.5 ? "Medium" : "High";
    // Safety stock ≈ 1.65 × σ (95% service) expressed in weeks of average demand, added to a 3-week base.
    const recommendedWeeks = cv === null ? null : round(Math.min(10, Math.max(3, 3 + 1.65 * cv * weeksPerMonth(rule))), 1);
    const currentWeeks = s.months[w.toIdx].weeks;
    const targetWeeks = 4;
    let verdict = "Not enough sales history";
    if (recommendedWeeks !== null) {
      if (currentWeeks === null) verdict = "No cover measured";
      else if (currentWeeks < recommendedWeeks - 0.5) verdict = `Below the ${recommendedWeeks.toFixed(1)}-week safety level`;
      else if (currentWeeks > recommendedWeeks + 3) verdict = "Well above the safety level";
      else verdict = "Cover matches the volatility";
    }
    return { sku: s.sku.name, weight: s.sku.weight, avgIms: round(mean), cv, volatility, recommendedWeeks, targetWeeks, currentWeeks, verdict };
  });
  variability.sort((x, y) => (y.cv ?? -1) - (x.cv ?? -1));
  return {
    total,
    byWeight,
    variability,
    method: "Last 12 months with actual IMS. Turns = annualised IMS ÷ average closing stock; days of inventory = 365 ÷ turns. Volatility = standard deviation ÷ mean of monthly IMS. Recommended cover = 3 weeks plus 1.65 × volatility × weeks per month, capped at 10 weeks.",
  };
}

// ── Market context (competitor data) ─────────────────────────────────────────

export interface CompetitorInput {
  brandMonthly: Record<string, Record<string, number[]>>;
  uploadedBy: string | null;
  uploadedAt: string | null;
}

export function buildMarket(a: { competitor: CompetitorInput | null; year: number; endMonth: number; ourBrand?: string }): MarketSection | null {
  if (!a.competitor || !a.competitor.brandMonthly || Object.keys(a.competitor.brandMonthly).length === 0) return null;
  const ourBrand = a.ourBrand ?? "Al Fakher";
  const bm = a.competitor.brandMonthly;
  const brands = Object.keys(bm);
  const val = (brand: string, year: number, m: number) => bm[brand]?.[String(year)]?.[m] ?? 0;
  const year = a.year;
  // Months covered = months where any brand has data in the year, capped at the window end month.
  let monthsCovered = 0;
  for (let m = 0; m < 12; m++) if (m < a.endMonth && brands.some((b) => val(b, year, m) > 0)) monthsCovered = m + 1;
  if (monthsCovered === 0) {
    // Fall back to the latest year with data.
    const years = Array.from(new Set(brands.flatMap((b) => Object.keys(bm[b] ?? {})))).map(Number).filter((y) => Number.isFinite(y)).sort();
    const latest = years.filter((y) => y < year).pop();
    if (latest === undefined) return null;
    return buildMarket({ ...a, year: latest, endMonth: 12 });
  }
  const notes: string[] = [];
  if (monthsCovered < a.endMonth) notes.push(`Competitor data covers ${monthsCovered} month${monthsCovered === 1 ? "" : "s"} of ${year}; our share is measured on those months.`);
  const ytd = (brand: string, y: number) => sum(Array.from({ length: monthsCovered }, (_, m) => val(brand, y, m)));
  const marketYtd = sum(brands.map((b) => ytd(b, year)));
  const marketLy = sum(brands.map((b) => ytd(b, year - 1)));
  const others = brands.filter((b) => b !== ourBrand && b.toLowerCase() !== "others");
  const mainCompetitor = others.sort((x, y) => ytd(y, year) - ytd(x, year))[0] ?? null;

  const trend: MarketPoint[] = [];
  for (let m = 0; m < monthsCovered; m++) {
    const ours = val(ourBrand, year, m);
    const market = sum(brands.map((b) => val(b, year, m)));
    const competitor = mainCompetitor ? val(mainCompetitor, year, m) : null;
    trend.push({
      label: `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m]}'${String(year).slice(2)}`,
      ours: round(ours),
      market: round(market),
      competitor: competitor === null ? null : round(competitor),
      sharePct: market > 0 ? round((ours / market) * 100, 1) : null,
      competitorSharePct: market > 0 && competitor !== null ? round((competitor / market) * 100, 1) : null,
    });
  }
  const oursYtd = ytd(ourBrand, year);
  const oursLy = ytd(ourBrand, year - 1);
  const sharePct = marketYtd > 0 ? round((oursYtd / marketYtd) * 100, 1) : null;
  const shareLyPct = marketLy > 0 ? round((oursLy / marketLy) * 100, 1) : null;
  const ourGrowthPct = oursLy > 0 ? pct(oursYtd, oursLy) : null;
  const marketGrowthPct = marketLy > 0 ? pct(marketYtd, marketLy) : null;
  const compYtd = mainCompetitor ? ytd(mainCompetitor, year) : 0;
  const compLy = mainCompetitor ? ytd(mainCompetitor, year - 1) : 0;
  const competitorGrowthPct = mainCompetitor && compLy > 0 ? pct(compYtd, compLy) : null;
  const outgrowing = ourGrowthPct !== null && marketGrowthPct !== null ? ourGrowthPct > marketGrowthPct : null;

  const brandRows: MarketBrandRow[] = brands
    .map((b) => {
      const y = ytd(b, year);
      const ly = ytd(b, year - 1);
      const sh = marketYtd > 0 ? round((y / marketYtd) * 100, 1) : null;
      const shLy = marketLy > 0 ? round((ly / marketLy) * 100, 1) : null;
      return { brand: b, ytd: round(y), lastYear: marketLy > 0 ? round(ly) : null, growthPct: ly > 0 ? pct(y, ly) : null, sharePct: sh, shareLyPct: shLy, sharePtsChange: sh !== null && shLy !== null ? round(sh - shLy, 1) : null };
    })
    .sort((x, y) => y.ytd - x.ytd);

  const shareTxt = sharePct === null ? "Market share cannot be measured" : `${ourBrand} holds ${sharePct.toFixed(1)}% of the market${shareLyPct !== null ? ` (${sharePct - shareLyPct >= 0 ? "+" : "−"}${Math.abs(sharePct - shareLyPct).toFixed(1)} pts vs last year)` : ""}`;
  const growthTxt =
    ourGrowthPct === null || marketGrowthPct === null
      ? ""
      : `; we are ${outgrowing ? "outgrowing" : "growing slower than"} the market (${ourGrowthPct >= 0 ? "+" : "−"}${Math.abs(ourGrowthPct).toFixed(1)}% vs market ${marketGrowthPct >= 0 ? "+" : "−"}${Math.abs(marketGrowthPct).toFixed(1)}%)`;
  const compTxt = mainCompetitor && marketYtd > 0 ? `. Main competitor ${mainCompetitor} holds ${round((compYtd / marketYtd) * 100, 1).toFixed(1)}%` : "";
  const message = `${shareTxt}${growthTxt}${compTxt}.`;
  notes.push("Source: the Competitor Analysis upload (market volumes in MC). The board pack does not change that data.");

  return {
    available: true,
    unit: "MC",
    ourBrand,
    mainCompetitor,
    year,
    monthsCovered,
    trend,
    sharePct,
    shareLyPct,
    sharePtsChange: sharePct !== null && shareLyPct !== null ? round(sharePct - shareLyPct, 1) : null,
    ourGrowthPct,
    marketGrowthPct,
    competitorGrowthPct,
    outgrowing,
    brands: brandRows,
    message,
    source: { uploadedBy: a.competitor.uploadedBy, uploadedAt: a.competitor.uploadedAt },
    notes,
  };
}

// ── Anomalies ────────────────────────────────────────────────────────────────

/** Flags points more than `z` standard deviations from the trailing 12-month mean (excluding the point itself). */
export function detectAnomalies(values: (number | null)[], opts: { z?: number; minHistory?: number; minAbs?: number } = {}): { idx: number; expected: number; z: number }[] {
  const z = opts.z ?? 2.5;
  const minHistory = opts.minHistory ?? 6;
  const minAbs = opts.minAbs ?? 1;
  const out: { idx: number; expected: number; z: number }[] = [];
  let lastHit: { idx: number; sign: number } | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    const hist: number[] = [];
    for (let k = i - 1; k >= 0 && hist.length < 12; k--) if (values[k] !== null) hist.push(values[k] as number);
    // Need a real baseline: enough history and enough of it non-zero (a launch is not an anomaly).
    if (hist.length < minHistory || hist.filter((h) => h > 0).length < minHistory) continue;
    const mean = avg(hist);
    const sd = Math.sqrt(sum(hist.map((h) => (h - mean) ** 2)) / (hist.length - 1));
    const floor = Math.max(mean * 0.1, minAbs);
    const score = (v - mean) / Math.max(sd, floor);
    if (Math.abs(score) >= z && Math.abs(v - mean) >= minAbs) {
      const sign = Math.sign(score);
      // A sustained shift is reported once (its first month), not every month until the average catches up.
      if (lastHit && lastHit.idx === i - 1 && lastHit.sign === sign) {
        lastHit = { idx: i, sign };
        continue;
      }
      out.push({ idx: i, expected: mean, z: round(score, 1) });
      lastHit = { idx: i, sign };
    }
  }
  return out;
}

export function buildAnomalies(a: { series: SkuSeries[]; periods: DatasetPeriod[]; w: Window; latestActualIdx: number; intl: boolean }): AnomalySection {
  const { series, periods, w } = a;
  const endIdx = Math.min(w.toIdx, Math.max(a.latestActualIdx, w.toIdx));
  const rows: AnomalyRow[] = [];
  const inWindow = (i: number) => i >= w.fromIdx && i <= Math.min(w.toIdx, endIdx);
  const measures: { measure: AnomalyRow["measure"]; pick: (c: SkuSeries["months"][number]) => number | null }[] = [
    { measure: "IMS", pick: (c) => (c.imsIsActual ? c.ims : null) },
    { measure: "Production", pick: (c) => (c.actualProduction > 0 || c.hasActualProduction ? c.actualProduction : null) },
    { measure: "Arrivals", pick: (c) => (c.arrivals > 0 ? c.arrivals : c.isFuture ? null : 0) },
  ];
  const push = (scope: AnomalyRow["scope"], name: string, weight: string, measure: AnomalyRow["measure"], values: (number | null)[], minAbs: number) => {
    for (const hit of detectAnomalies(values, { minAbs })) {
      if (!inWindow(hit.idx)) continue;
      const value = values[hit.idx] as number;
      const deviationMc = value - hit.expected;
      const direction = deviationMc >= 0 ? "above" : "below";
      const severity: Rag = Math.abs(hit.z) >= 4 ? "red" : "amber";
      const explanation = `${measure} for ${name} in ${shortLabel(periods[hit.idx])} was ${fmt(value)} MC, ${fmtPct(hit.expected > 0 ? pct(value, hit.expected) : null)} ${direction} its usual ${fmt(hit.expected)} MC.`;
      rows.push({ scope, name, weight, measure, month: shortLabel(periods[hit.idx]), value: round(value), expected: round(hit.expected), deviationMc: round(deviationMc), deviationPct: hit.expected > 0 ? pct(value, hit.expected) : null, zScore: hit.z, direction, severity, explanation });
    }
  };
  const weights = Array.from(new Set(series.map((s) => s.sku.weight)));
  for (const m of measures) {
    for (const wt of weights) {
      const members = series.filter((s) => s.sku.weight === wt);
      const values = periods.map((_, i) => {
        const vs = members.map((s) => m.pick(s.months[i]));
        return vs.every((v) => v === null) ? null : sum(vs.map((v) => v ?? 0));
      });
      push("weight", wt, wt, m.measure, values, 20);
    }
    for (const s of series) push("sku", s.sku.name, s.sku.weight, m.measure, s.months.map((c) => m.pick(c)), 5);
  }
  rows.sort((x, y) => Math.abs(y.zScore) - Math.abs(x.zScore) || Math.abs(y.deviationMc) - Math.abs(x.deviationMc));
  return {
    rows: rows.slice(0, 40),
    monthsScanned: w.months.length,
    method: "A month is flagged when it sits more than 2.5 standard deviations from the SKU's (or weight's) trailing 12-month average, with at least 6 months of history. Red = more than 4 standard deviations.",
    notes: rows.length ? [] : ["No unusual months in this period."],
  };
}

// ── Board headline ───────────────────────────────────────────────────────────

export function buildHeadline(a: {
  country: PerformanceCountry;
  windowLabel: string;
  generatedAt: string;
  runningRate: RunningRateSection;
  outlook: OutlookSection;
  closingStock: number;
  weeksOfCover: number | null;
  forecastAccuracyPct: number | null;
  stockoutRiskSkus: number;
  overstockSkus: number;
  risks: { sku: string; issue: string; severity: Rag }[];
  series: SkuSeries[];
  periods: DatasetPeriod[];
}): BoardHeadline {
  const { outlook, series, periods } = a;
  const year = outlook.year;
  const throughMonth = outlook.monthsElapsed;
  const skuForecasts = series.map((s) => ({
    sku: s.sku.name,
    weight: s.sku.weight,
    remainingForecast: round(sum(s.months.filter((c, i) => periods[i].year === year && periods[i].month > throughMonth).map((c) => c.forecast))),
  }));
  const ytdPlan = round(sum(outlook.monthly.filter((m) => m.actual !== null).map((m) => m.plan ?? 0)));
  return {
    version: 1,
    country: a.country,
    windowLabel: a.windowLabel,
    year,
    asOf: a.runningRate.asOf,
    generatedAt: a.generatedAt,
    ytdIms: outlook.total.ytdActual,
    ytdPlan: outlook.total.annualPlan === null ? null : ytdPlan,
    landing: outlook.total.landing,
    annualPlan: outlook.total.annualPlan,
    remainingForecast: outlook.total.remainingForecast,
    runningRate: a.runningRate.headline.value,
    closingStock: round(a.closingStock),
    weeksOfCover: a.weeksOfCover,
    forecastAccuracyPct: a.forecastAccuracyPct,
    stockoutRiskSkus: a.stockoutRiskSkus,
    overstockSkus: a.overstockSkus,
    risks: a.risks.map((r) => ({ sku: r.sku, issue: r.issue, severity: r.severity })),
    skuForecasts,
  };
}

/** Implied weeks of cover on totals at a given monthly rate, using the country's weeks-per-month factor. */
export function impliedWeeks(closing: number, monthlyRate: number, country: PerformanceCountry): number | null {
  if (monthlyRate <= 0) return null;
  const rule = coverRuleFor(country);
  return round((closing / monthlyRate) * rule.factor, 1);
}

// Re-export for callers that only need the intl test.
export { isIntlCountry, weeksOfCoverAt };
