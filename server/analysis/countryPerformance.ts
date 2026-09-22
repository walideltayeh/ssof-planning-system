/**
 * Country Performance pack — server aggregator.
 *
 * One call per country + period builds every section of the board pack from a
 * short-lived cached dataset (the same rows the Planning FG pages read). All
 * arithmetic lives in countryPerformance.helpers.ts / shared/performance so it
 * can be unit tested without a database.
 */

import * as db from "../db";
import { compareHeadlines } from "../../shared/performance/boardCompare";
import type { WorkbookExtras } from "./countryPerformanceExcel";
import { describeUpdate } from "@shared/audit/lastUpdate";
import { BoardHeadlineSchema } from "./countryPerformance.schemas";
import {
  baselineFromSnapshot,
  buildAnomalies,
  buildEfficiency,
  buildHeadline,
  buildLostSales,
  buildMarket,
  buildOutlook,
  buildPortfolio,
  buildRunningRate,
  buildVolumeBridge,
  type BudgetBaseline,
} from "./countryPerformance.extra";
import { aggregateProjection, classifyZone, coverDemandReferenceAt, coverRuleFor, mcForWeeks, projectSku } from "../../shared/performance/projection";
import {
  accuracyByGroup,
  accuracyByMonth,
  accuracyOf,
  accuracySamples,
  applyFilters,
  buildBatches,
  buildKeyMessages,
  buildRisks,
  buildSkuSeries,
  chronicBias,
  compareLabel,
  confidenceScore,
  currentYm,
  daysBetween,
  expiryAtRisk,
  filterOptions,
  flavourOf,
  isIntlCountry,
  isoDate,
  lastYearWindow,
  latestActualImsIndex,
  makeDelta,
  monthIndexOf,
  monthlyTotals,
  num,
  paretoRows,
  parseYm,
  pct,
  plannedArrivalsMap,
  previousWindow,
  projectionInputs,
  ragAccuracy,
  ragAttainment,
  ragCount,
  ragCover,
  ragVsPlan,
  ragWeeksOfDemand,
  resolveWindow,
  round,
  runningRate,
  seasonalityIndex,
  shortLabel,
  shortfallBeforeNextArrival,
  sortedPeriods,
  sparkline,
  stockoutRisk,
  sum,
  sumAt,
  sumOver,
  toPeriodRef,
  topMovers,
  totalWeeksAt,
  windowLabel,
  type Batch,
  type DatasetPeriod,
  type PerformanceDataset,
  type SkuSeries,
  type Window,
} from "./countryPerformance.helpers";
import type {
  AttainmentMonth,
  CommercialRow,
  CommercialSection,
  ConfidenceIssue,
  DataConfidenceSection,
  DemandMonth,
  DemandSection,
  FlowSection,
  ForecastQualitySection,
  ForwardMonth,
  ForwardSection,
  GapRow,
  InventorySection,
  KpiTile,
  LeadTimeStat,
  MixDimension,
  PerformanceCountry,
  PerformanceMeta,
  PerformancePack,
  PerformanceRequest,
  PipelineStage,
  Rag,
  SupplySection,
  WaterfallStep,
  YoyMonth,
} from "./countryPerformance.types";

export type { PerformancePack, PerformanceRequest } from "./countryPerformance.types";

// ── Dataset cache ────────────────────────────────────────────────────────────

const DATASET_TTL_MS = 60_000;
const datasetCache = new Map<string, { loadedAt: number; promise: Promise<PerformanceDataset> }>();
const packCache = new Map<string, { at: number; pack: PerformancePack }>();

export function invalidateCountryPerformanceCache(country?: PerformanceCountry) {
  if (!country) {
    datasetCache.clear();
    packCache.clear();
    return;
  }
  datasetCache.delete(country);
  for (const k of Array.from(packCache.keys())) if (k.startsWith(`${country}|`)) packCache.delete(k);
}

async function loadDataset(country: PerformanceCountry): Promise<PerformanceDataset> {
  const full = await db.getFullPlanningDataForCountry(country);
  const expiryRows = isIntlCountry(country)
    ? (await db.getExpiryDashboard(country as "Syria" | "Libya" | "KSA")).rows.map((r) => ({
        skuId: r.skuId,
        skuName: r.skuName,
        weight: r.weight,
        productionPeriodLabel: r.productionPeriodLabel,
        productionDate: r.productionDate,
        expiryDate: r.expiryDate,
        totalRemaining: r.totalRemaining,
        monthsUntilExpiry: r.monthsUntilExpiry,
      }))
    : [];
  const inactiveSkus = full.skus.filter((s) => s.isActive === false);
  const [inactiveIms, competitor] = await Promise.all([
    inactiveSkus.length ? db.getImsForSkus(inactiveSkus.map((s) => s.id)) : Promise.resolve([]),
    country === "Lebanon" ? db.getCompetitorData(country) : Promise.resolve(null),
  ]);
  return {
    country,
    skus: full.skus.filter((s) => s.isActive !== false),
    inactiveSkus,
    inactiveIms,
    competitor: competitor
      ? {
          brandMonthly: (competitor.brandMonthly ?? {}) as Record<string, Record<string, number[]>>,
          uploadedBy: competitor.uploadedBy ?? null,
          uploadedAt: competitor.uploadedAt ? new Date(competitor.uploadedAt).toISOString() : null,
        }
      : null,
    periods: full.periods,
    forecast: full.forecast,
    ims: full.ims,
    shipment: full.shipment,
    arrival: full.arrival,
    planningFg: full.planningFg,
    clearanceEvents: (full as { clearanceEvents?: PerformanceDataset["clearanceEvents"] }).clearanceEvents ?? [],
    actualProduction: full.actualProduction,
    expiryRows,
    now: new Date(),
  };
}

export async function getCountryDataset(country: PerformanceCountry, refresh = false): Promise<PerformanceDataset> {
  const hit = datasetCache.get(country);
  if (!refresh && hit && Date.now() - hit.loadedAt < DATASET_TTL_MS) return hit.promise;
  const promise = loadDataset(country).catch((err) => {
    datasetCache.delete(country);
    throw err;
  });
  datasetCache.set(country, { loadedAt: Date.now(), promise });
  return promise;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function getCountryPerformance(req: PerformanceRequest & { refresh?: boolean }): Promise<PerformancePack> {
  const cacheKey = `${req.country}|${JSON.stringify({ p: req.preset, a: req.anchor ?? null, f: req.from ?? null, t: req.to ?? null, c: req.compare, fl: req.filters ?? {} })}`;
  const hit = packCache.get(cacheKey);
  if (!req.refresh && hit && Date.now() - hit.at < DATASET_TTL_MS) return hit.pack;
  const ds = await getCountryDataset(req.country, req.refresh);
  const reconciliationSource = await db.getCurrentMonthClosingStock(req.country);
  const baseline = await loadBudgetBaseline(ds, req);
  const pack = buildPack(ds, req, reconciliationSource?.skuData ?? null, baseline);
  packCache.set(cacheKey, { at: Date.now(), pack });
  return pack;
}

/** The saved version an admin chose as the approved annual plan for the year the request lands in. */
async function loadBudgetBaseline(ds: PerformanceDataset, req: PerformanceRequest): Promise<BudgetBaseline | null> {
  const periods = sortedPeriods(ds);
  if (periods.length === 0) return null;
  const anchorYm = parseYm(req.preset === "custom" ? req.to : req.anchor);
  const year = anchorYm?.year ?? periods[Math.max(0, latestActualImsIndex(buildSkuSeries(ds, ds.skus), periods, ds.now))]?.year ?? ds.now.getFullYear();
  const chosen = await db.getBoardPlanBaseline(ds.country, year);
  if (!chosen) return null;
  const version = await db.getVersionById(chosen.versionId);
  if (!version || version.country !== ds.country) return null;
  return baselineFromSnapshot(version);
}

const ymKey = (p: DatasetPeriod) => `${p.year}-${String(p.month).padStart(2, "0")}`;

/** Everything the Excel export needs beyond the pack: the previous frozen board and presenter notes. */
export async function loadWorkbookExtras(pack: PerformancePack): Promise<WorkbookExtras> {
  const [snapshots, notes, updates] = await Promise.all([
    db.listBoardPackSnapshots(pack.meta.country),
    db.listPresenterNotes(pack.meta.country, pack.meta.periodKey),
    db.getLatestDataUpdates([pack.meta.country]),
  ]);
  const latest = updates[0];
  const lastUpdate = latest?.at ? { at: latest.at, by: latest.displayName ?? latest.username ?? "unknown user", what: describeUpdate(latest.action ?? "", latest.sheet) } : null;
  let comparison: WorkbookExtras["comparison"] = null;
  if (snapshots[0]) {
    const prev = await db.getBoardPackSnapshot(snapshots[0].id);
    const parsed = prev ? BoardHeadlineSchema.safeParse(prev.headline) : null;
    if (prev && parsed?.success) comparison = { previousName: prev.name, previousDate: prev.createdAt.toISOString(), result: compareHeadlines(pack.headline, parsed.data) };
  }
  return { comparison, lastUpdate, notes: notes.map((n) => ({ sectionId: n.sectionId, body: n.body, author: n.author, updatedAt: n.updatedAt.toISOString() })) };
}


// ── Pack builder (pure given a dataset) ──────────────────────────────────────

export function buildPack(
  ds: PerformanceDataset,
  req: PerformanceRequest,
  reconciliationSource: { id: number; name: string; weight: string; closingStock: number }[] | null,
  baseline: BudgetBaseline | null = null,
): PerformancePack {
  const country = ds.country;
  const intl = isIntlCountry(country);
  const periods = sortedPeriods(ds);
  const rule = coverRuleFor(country);
  const now = ds.now;

  const allSeriesUnfiltered = buildSkuSeries(ds, ds.skus);
  const filteredSkus = applyFilters(ds.skus, req.filters);
  const batchesAll = intl ? buildBatches(ds, ds.skus) : [];
  const planned = plannedArrivalsMap(ds, filteredSkus, batchesAll);
  const series = buildSkuSeries(ds, filteredSkus, planned);
  const batches = batchesAll.filter((b) => filteredSkus.some((s) => s.id === b.sku.id));

  if (periods.length === 0) throw new Error(`No planning periods exist for ${country}`);

  // Window resolution
  const latestActualIdx = latestActualImsIndex(allSeriesUnfiltered, periods, now);
  const anchorYm = parseYm(req.anchor);
  const anchorIdxRaw = anchorYm ? monthIndexOf(periods, anchorYm.year, anchorYm.month) : -1;
  const anchorIdx = anchorIdxRaw >= 0 ? anchorIdxRaw : latestActualIdx;
  const w = resolveWindow(periods, req.preset, anchorIdx, req.from, req.to);
  const lyW = lastYearWindow(periods, w);
  const prevW = previousWindow(periods, w);
  const chartW: Window = w.months.length >= 6 ? w : resolveWindow(periods, "l12m", w.toIdx);
  const cur = currentYm(now);
  const currentIdx = monthIndexOf(periods, cur.year, cur.month);

  const lyNote = lyW ? (lyW.months.length < w.months.length ? `Partial prior-year data (${lyW.months.length} of ${w.months.length} months)` : undefined) : "No prior year data";
  const prevNote = prevW ? undefined : "No earlier months available";

  // Monthly totals across the filtered SKUs
  const mIms = monthlyTotals(series, periods, (c) => c.ims);
  const mImsActual: (number | null)[] = periods.map((_, i) => {
    const anyActual = series.some((s) => s.months[i].imsIsActual);
    return anyActual ? sum(series.map((s) => (s.months[i].imsIsActual ? s.months[i].ims : 0))) : null;
  });
  const mPlan = monthlyTotals(series, periods, (c) => c.forecast);
  const mProd = monthlyTotals(series, periods, (c) => c.actualProduction);
  const mArr = monthlyTotals(series, periods, (c) => c.arrivals);
  const mPlannedArr = monthlyTotals(series, periods, (c) => c.plannedArrivals);
  const mClosing = monthlyTotals(series, periods, (c) => c.closing);
  const mWeeks = periods.map((_, i) => totalWeeksAt(series, i, country));
  const mCritical = periods.map((_, i) => series.filter((s) => ["Critical", "Out of Stock", "Negative"].includes(s.months[i].zone) && s.months[i].demand > 0).length);
  const mOver = periods.map((_, i) => series.filter((s) => s.months[i].zone === "Overstock").length);
  const mAccuracy = periods.map((_, i) => accuracyOf(series.filter((s) => s.months[i].imsIsActual).map((s) => ({ forecast: s.months[i].forecast, actual: s.months[i].ims }))).accuracyPct);
  const mAttain = periods.map((_, i) => (mPlan[i] > 0 ? round((mProd[i] / mPlan[i]) * 100, 1) : null));

  const pickWindow = (arr: (number | null)[], win: Window | null): number | null => {
    if (!win) return null;
    let total = 0;
    for (let i = win.fromIdx; i <= win.toIdx; i++) total += arr[i] ?? 0;
    return total;
  };

  // Core window figures
  const ims = pickWindow(mIms, w) ?? 0;
  const imsPlan = pickWindow(mPlan, w);
  const imsLy = pickWindow(mIms, lyW);
  const imsPrev = pickWindow(mIms, prevW);
  const production = pickWindow(mProd, w) ?? 0;
  const productionPlan = pickWindow(mPlan, w);
  const productionLy = pickWindow(mProd, lyW);
  const productionPrev = pickWindow(mProd, prevW);
  const arrivals = pickWindow(mArr, w) ?? 0;
  const arrivalsPlan = pickWindow(mPlannedArr, w);
  const arrivalsLy = pickWindow(mArr, lyW);
  const arrivalsPrev = pickWindow(mArr, prevW);
  const closing = mClosing[w.toIdx] ?? 0;
  const closingLy = lyW ? mClosing[lyW.toIdx] : null;
  const closingPrev = prevW ? mClosing[prevW.toIdx] : null;
  const weeks = mWeeks[w.toIdx];
  const weeksLy = lyW ? mWeeks[lyW.toIdx] : null;
  const weeksPrev = prevW ? mWeeks[prevW.toIdx] : null;

  const acc = accuracySamples(series, w);
  const accOverall = accuracyOf(acc.samples);
  const accLy = lyW ? accuracyOf(accuracySamples(series, lyW).samples).accuracyPct : null;
  const accPrev = prevW ? accuracyOf(accuracySamples(series, prevW).samples).accuracyPct : null;
  const attainment = productionPlan && productionPlan > 0 ? round((production / productionPlan) * 100, 1) : null;
  const attainmentLy = productionLy !== null && pickWindow(mPlan, lyW) ? round((productionLy / (pickWindow(mPlan, lyW) as number)) * 100, 1) : null;
  const attainmentPrev = productionPrev !== null && pickWindow(mPlan, prevW) ? round((productionPrev / (pickWindow(mPlan, prevW) as number)) * 100, 1) : null;

  // Projection inputs from the window end
  const horizon = 6;
  const projRows = projectionInputs(series, periods, w.toIdx, horizon, intl);
  const horizonLabels = projRows[0]?.labels ?? [];
  const demandRef = (i: number) => coverDemandReferenceAt(mIms.map((v, j) => (intl ? v : sumAt(series, j, (c) => c.effectiveIms) ?? 0)), i, rule);
  const monthlyDemand = (() => {
    const xs: number[] = [];
    for (let i = w.toIdx; i >= 0 && xs.length < 3; i--) if ((mImsActual[i] ?? 0) > 0) xs.push(mImsActual[i] as number);
    return xs.length ? sum(xs) / xs.length : demandRef(w.toIdx);
  })();

  // Inventory analytics at the window end
  const coverRows = series.map((s) => {
    const c = s.months[w.toIdx];
    const demands = s.months.map((m) => (intl ? m.ims : m.effectiveIms));
    return {
      skuId: s.sku.id,
      sku: s.sku.name,
      weight: s.sku.weight,
      category: s.sku.category ?? "Core",
      closingStock: round(c.closing),
      weeks: c.weeks === null ? null : round(c.weeks, 1),
      zone: c.zone,
      monthlyDemand: round(coverDemandReferenceAt(demands, w.toIdx, rule)),
    };
  });
  const atRisk = projRows
    .map((row) => {
      const cell = series.find((s) => s.sku.id === row.sku.id)!.months[w.toIdx];
      const risk = stockoutRisk(row, 3);
      const zoneRisk = ["Critical", "Out of Stock", "Negative"].includes(cell.zone) && (row.demand[0] ?? 0) > 0;
      if (!risk && !zoneRisk) return null;
      const sf = shortfallBeforeNextArrival(row);
      const stockoutMonth = risk ? periods[w.toIdx + 1 + risk.monthIndex] : null;
      return {
        sku: row.sku.name,
        weight: row.sku.weight,
        closingStock: round(row.openingStock),
        weeks: cell.weeks === null ? null : round(cell.weeks, 1),
        projectedStockoutMonth: stockoutMonth ? shortLabel(stockoutMonth) : null,
        projectedStockoutDate: stockoutMonth && risk ? isoDate(new Date(stockoutMonth.year, stockoutMonth.month - 1, risk.dayOfMonth)) : null,
        nextArrival: sf.nextArrival ? { month: row.labels[sf.nextArrival.index], mc: round(sf.nextArrival.mc) } : null,
        shortfallMc: round(sf.shortfall > 0 ? sf.shortfall : Math.max(0, (row.demand[0] ?? 0) - Math.max(0, row.openingStock))),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.shortfallMc - a.shortfallMc);
  const overstock = series
    .filter((s) => s.months[w.toIdx].zone === "Overstock")
    .map((s) => {
      const c = s.months[w.toIdx];
      const demands = s.months.map((m) => (intl ? m.ims : m.effectiveIms));
      const ceiling = mcForWeeks(6, demands, w.toIdx, rule);
      const row = projRows.find((r) => r.sku.id === s.sku.id)!;
      const fwd = row.demand.slice(0, 3);
      const avgFwd = fwd.length ? sum(fwd) / fwd.length : 0;
      return {
        sku: s.sku.name,
        weight: s.sku.weight,
        closingStock: round(c.closing),
        weeks: c.weeks === null ? null : round(c.weeks, 1),
        excessMc: round(Math.max(0, c.closing - ceiling)),
        monthsToSell: avgFwd > 0 ? round(c.closing / avgFwd, 1) : null,
        monthlyDemand: round(avgFwd),
      };
    })
    .sort((a, b) => b.excessMc - a.excessMc);

  // Expiry risk (intl)
  const runRateBySku = new Map<number, number>();
  for (const s of series) {
    const xs: number[] = [];
    for (let i = w.toIdx; i >= 0 && xs.length < 3; i--) if (s.months[i].imsIsActual) xs.push(s.months[i].ims);
    runRateBySku.set(s.sku.id, xs.length ? sum(xs) / xs.length : 0);
  }
  const expiryRows = intl ? expiryAtRisk((ds.expiryRows ?? []).filter((r) => filteredSkus.some((s) => s.id === r.skuId)), runRateBySku) : [];
  const expiryRiskMc = intl ? round(sum(expiryRows.map((r) => r.atRiskMc))) : null;

  // Pending clearance / delays (intl)
  const producedBatches = batches.filter((b) => b.producedMc > 0 && periods.findIndex((p) => p.id === b.period.id) <= w.toIdx);
  const pendingClearanceMc = intl ? round(sum(producedBatches.map((b) => b.pendingMc))) : null;
  const delayed = intl
    ? batches
        .filter((b) => b.pendingMc > 0 && b.expectedArrival && b.expectedArrival <= now && b.status !== "Cleared" && daysBetween(b.expectedArrival, now) > 7)
        .map((b) => ({
          sku: b.sku.name,
          weight: b.sku.weight,
          productionPeriod: b.period.label,
          producedMc: round(b.producedMc),
          clearedMc: round(b.clearedMc),
          pendingMc: round(b.pendingMc),
          expectedArrival: isoDate(b.expectedArrival),
          daysLate: b.expectedArrival ? daysBetween(b.expectedArrival, now) : null,
          status: b.status,
          invoiceRef: b.invoiceRef,
          containerRef: b.containerRef,
          note: b.note,
        }))
        .sort((a, b) => (b.daysLate ?? 0) - (a.daysLate ?? 0))
    : [];

  // ── Tiles ──────────────────────────────────────────────────────────────────
  const tiles: KpiTile[] = [];
  const spark = (arr: (number | null)[]) => sparkline(periods, w.toIdx, arr);

  {
    const vsPlan = makeDelta(ims, imsPlan, "No forecast in this period");
    const r = ragVsPlan(vsPlan.pct);
    tiles.push({
      key: "ims",
      label: "Sell-out (IMS)",
      question: "How much did we sell, and is it what we planned?",
      value: round(ims),
      unit: "MC",
      vsPlan,
      vsLastYear: makeDelta(ims, imsLy, lyNote),
      vsPrevious: makeDelta(ims, imsPrev, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mIms),
      note: series.some((s) => w.months.some((_, k) => s.months[w.fromIdx + k].ims !== 0 && s.months[w.fromIdx + k].imsSource === "auto_forecast")) ? "Includes auto-filled IMS months" : undefined,
    });
  }
  {
    const vsPlan = makeDelta(production, productionPlan, "No production plan in this period");
    const r = ragAttainment(attainment);
    tiles.push({
      key: "production",
      label: "Production",
      question: "Did the factory deliver what we asked for?",
      value: round(production),
      unit: "MC",
      vsPlan,
      vsLastYear: makeDelta(production, productionLy, lyNote),
      vsPrevious: makeDelta(production, productionPrev, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mProd),
    });
  }
  {
    const vsPlan = makeDelta(arrivals, arrivalsPlan, "No planned arrivals in this period");
    const r = ragVsPlan(vsPlan.pct, [-10, -25]);
    tiles.push({
      key: "arrivals",
      label: intl ? "Arrivals (cleared)" : "Arrivals",
      question: intl ? "How much cleared customs and reached the market?" : "How much reached the market?",
      value: round(arrivals),
      unit: "MC",
      vsPlan,
      vsLastYear: makeDelta(arrivals, arrivalsLy, lyNote),
      vsPrevious: makeDelta(arrivals, arrivalsPrev, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mArr),
      note: intl ? "Planned = production batches expected to land in the period" : "Planned = forecast production shifted by the arrival offset",
    });
  }
  {
    const r = ragCover(weeks, closing);
    tiles.push({
      key: "closing",
      label: "Closing stock",
      question: "How much stock do we hold at the end of the period?",
      value: round(closing),
      unit: "MC",
      vsPlan: null,
      vsLastYear: makeDelta(closing, closingLy, lyNote),
      vsPrevious: makeDelta(closing, closingPrev, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mClosing),
      subValue: weeks === null ? (closing > 0 ? "No sales to measure cover" : "No stock") : `${weeks.toFixed(1)} weeks of cover`,
      note: "Matches the Planning FG closing stock",
    });
  }
  {
    const r = ragCover(weeks, closing);
    tiles.push({
      key: "cover",
      label: "Weeks of cover",
      question: "How long will today's stock last?",
      value: weeks === null ? null : round(weeks, 1),
      unit: "weeks",
      vsPlan: makeDelta(weeks, 5, undefined),
      vsLastYear: makeDelta(weeks, weeksLy, lyNote),
      vsPrevious: makeDelta(weeks, weeksPrev, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mWeeks.map((v) => (v === null ? null : round(v, 1)))),
      note: intl ? "Closing ÷ same-month IMS × 4 (Planning FG rule)" : "Closing ÷ average of next 2 months IMS × 4.3 (Planning FG rule)",
    });
  }
  {
    const r = ragAccuracy(accOverall.accuracyPct);
    tiles.push({
      key: "accuracy",
      label: "Forecast accuracy",
      question: "How close was the forecast to what actually sold?",
      value: accOverall.accuracyPct,
      unit: "pct",
      vsPlan: makeDelta(accOverall.accuracyPct, 85, undefined),
      vsLastYear: makeDelta(accOverall.accuracyPct, accLy, lyNote),
      vsPrevious: makeDelta(accOverall.accuracyPct, accPrev, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mAccuracy),
      subValue: accOverall.biasPct === null ? undefined : `${accOverall.biasPct > 0 ? "Over" : "Under"}-forecast by ${Math.abs(accOverall.biasPct).toFixed(1)}%`,
      note: acc.excludedAutoFilled > 0 ? `${acc.excludedAutoFilled} auto-filled IMS month(s) excluded` : undefined,
    });
  }
  {
    const r = ragAttainment(attainment);
    tiles.push({
      key: "attainment",
      label: "Plan attainment",
      question: "What share of the production plan was delivered?",
      value: attainment,
      unit: "pct",
      vsPlan: makeDelta(attainment, 100, undefined),
      vsLastYear: makeDelta(attainment, attainmentLy, lyNote),
      vsPrevious: makeDelta(attainment, attainmentPrev, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mAttain),
    });
  }
  {
    const r = ragCount(atRisk.length, series.length);
    tiles.push({
      key: "stockoutRisk",
      label: "SKUs at stock-out risk",
      question: "Which products could run out in the next 3 months?",
      value: atRisk.length,
      unit: "count",
      vsPlan: null,
      vsLastYear: makeDelta(atRisk.length, lyW ? mCritical[lyW.toIdx] : null, lyNote),
      vsPrevious: makeDelta(atRisk.length, prevW ? mCritical[prevW.toIdx] : null, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mCritical),
      subValue: atRisk.length ? `Shortfall ${round(sum(atRisk.map((a) => a.shortfallMc))).toLocaleString("en-US")} MC` : undefined,
    });
  }
  {
    const r = ragCount(overstock.length, series.length);
    tiles.push({
      key: "overstock",
      label: "Overstocked SKUs",
      question: "Where is cash tied up in slow stock?",
      value: overstock.length,
      unit: "count",
      vsPlan: null,
      vsLastYear: makeDelta(overstock.length, lyW ? mOver[lyW.toIdx] : null, lyNote),
      vsPrevious: makeDelta(overstock.length, prevW ? mOver[prevW.toIdx] : null, prevNote),
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mOver),
      subValue: overstock.length ? `Excess ${round(sum(overstock.map((o) => o.excessMc))).toLocaleString("en-US")} MC` : undefined,
    });
  }
  if (intl) {
    const mPending = periods.map((_, i) => round(sum(batches.filter((b) => b.period.id === periods[i].id).map((b) => b.pendingMc))));
    const r = ragWeeksOfDemand(pendingClearanceMc ?? 0, monthlyDemand);
    tiles.push({
      key: "pendingClearance",
      label: "Pending clearance",
      question: "How much product is produced but not yet released by customs?",
      value: pendingClearanceMc,
      unit: "MC",
      vsPlan: null,
      vsLastYear: null,
      vsPrevious: null,
      status: r.status,
      statusReason: r.reason,
      sparkline: spark(mPending),
      subValue: delayed.length ? `${delayed.length} batch${delayed.length > 1 ? "es" : ""} delayed` : "No delayed batches",
      note: "By production month; produced minus cleared",
    });
    const rr: { status: Rag; reason: string } = (expiryRiskMc ?? 0) <= 0 ? { status: "green", reason: "Nothing expires before it sells" } : (expiryRiskMc ?? 0) < closing * 0.05 ? { status: "amber", reason: "Under 5% of stock at risk" } : { status: "red", reason: "5% or more of stock at risk" };
    tiles.push({
      key: "expiryRisk",
      label: "Expiry risk",
      question: "How much stock could expire before it sells?",
      value: expiryRiskMc,
      unit: "MC",
      vsPlan: null,
      vsLastYear: null,
      vsPrevious: null,
      status: rr.status,
      statusReason: rr.reason,
      sparkline: [],
      note: "First-in-first-out at the current 3-month run-rate; shelf life 2 years from production",
    });
  }

  const wLabel = windowLabel(w, req.preset);

  // ── Key messages & risks ───────────────────────────────────────────────────
  const keyMessages = buildKeyMessages({
    country,
    windowLabel: wLabel,
    ims,
    imsPlan,
    imsLy,
    production,
    productionPlan,
    closing,
    weeks,
    criticalSkus: atRisk.map((a) => ({ sku: a.sku, shortfall: a.shortfallMc })),
    overstockSkus: overstock.map((o) => ({ sku: o.sku, excess: o.excessMc })),
    accuracyPct: accOverall.accuracyPct,
    absForecastError: sum(acc.samples.map((s) => Math.abs(s.forecast - s.actual))),
    pendingClearanceMc,
    delayedBatches: delayed.length,
    expiryRiskMc,
    monthlyDemand,
  });
  const chronic = chronicBias(series, w.toIdx);
  const risks = buildRisks({
    atRisk: atRisk.map((a) => ({ sku: a.sku, weight: a.weight, shortfall: a.shortfallMc, stockoutDate: a.projectedStockoutDate, nextArrival: a.nextArrival })),
    overstock: overstock.map((o) => ({ sku: o.sku, weight: o.weight, excess: o.excessMc, monthsToSell: o.monthsToSell })),
    delayed: delayed.map((d) => ({ sku: d.sku, weight: d.weight, pendingMc: d.pendingMc, daysLate: d.daysLate, invoiceRef: d.invoiceRef, productionPeriod: d.productionPeriod })),
    chronic: chronic.map((c) => ({ ...c, monthlyDemand: runRateBySku.get(series.find((s) => s.sku.name === c.sku)?.sku.id ?? -1) ?? 0 })),
    expiry: expiryRows.slice(0, 3).map((e) => ({ sku: e.sku, weight: e.weight, atRiskMc: e.atRiskMc, expiryDate: e.expiryDate })),
  });

  // ── Sections ───────────────────────────────────────────────────────────────
  const flow = buildFlow({ intl, w, series, batches, periods, now, ims, imsPlan, production, productionPlan, arrivals, closing, monthlyDemand, delayed, mIms, mArr });
  const demandBase = buildDemand({ series, periods, w, lyW, prevW, chartW, mIms, mImsActual, mPlan });
  const supply = buildSupply({ intl, series, periods, chartW, w, batches, now, mPlan, mProd, mIms, mArr, mPlannedArr });
  const inventoryBase = buildInventory({ intl, series, periods, w, projRows, coverRows, atRisk, overstock, expiryRows, filteredSkus, rule });
  const forecastQuality = buildForecastQuality({ series, chartW, w, chronic, acc, accOverall });
  const forward = buildForward({ intl, series, periods, w, projRows, horizonLabels, batches, ds, rule, currentIdx });
  const commercial = buildCommercial({ series, w, lyW, filteredSkus });
  const confidence = buildConfidence({ ds, series: allSeriesUnfiltered, filteredSeries: series, periods, w, currentIdx, latestActualIdx, reconciliationSource, horizon });

  // ── Board additions ────────────────────────────────────────────────────
  const runningRate = buildRunningRate({ country, series, periods, w, latestActualIdx, mPlan, mIms, mImsActual, rule });
  const outlook = buildOutlook({ series, periods, w, latestActualIdx, mImsActual, baseline, currentRate: runningRate.headline.value, rule });
  const inactive = applyFilters(ds.inactiveSkus ?? [], req.filters).map((sku) => ({
    sku,
    ims: periods.map((p) => sum((ds.inactiveIms ?? []).filter((r) => r.skuId === sku.id && r.periodId === p.id).map((r) => parseFloat(String(r.value ?? "0")) || 0))),
  }));
  const demand: DemandSection = { ...demandBase, bridge: buildVolumeBridge({ series, periods, w, lyW, inactive, windowLabel: wLabel, lyLabel: lyW ? windowLabel(lyW, req.preset) : null }) };
  const portfolio = buildPortfolio({ series, periods, w, lyW, prevW, rule });
  const inventory: InventorySection = {
    ...inventoryBase,
    lostSales: buildLostSales({ series, periods, w, latestActualIdx }),
    efficiency: buildEfficiency({ series, periods, w, latestActualIdx, rule }),
  };
  const market = buildMarket({ competitor: ds.competitor ?? null, year: periods[w.toIdx].year, endMonth: periods[w.toIdx].month });
  const anomalies = buildAnomalies({ series, periods, w, latestActualIdx, intl });

  const dataAsOf = latestUpdatedAt(ds);
  const meta: PerformanceMeta = {
    country,
    isIntl: intl,
    generatedAt: new Date().toISOString(),
    dataAsOf,
    preset: req.preset,
    compare: req.compare,
    filters: req.filters ?? {},
    window: { from: toPeriodRef(w.months[0]), to: toPeriodRef(w.months[w.months.length - 1]), months: w.months.map(toPeriodRef), label: wLabel },
    periodKey: `${req.preset}:${ymKey(w.months[0])}:${ymKey(w.months[w.months.length - 1])}`,
    chartWindow: { from: toPeriodRef(chartW.months[0]), to: toPeriodRef(chartW.months[chartW.months.length - 1]), months: chartW.months.map(toPeriodRef), label: windowLabel(chartW, chartW === w ? req.preset : "l12m") },
    compareLabel: compareLabel(req.compare),
    lastYearAvailable: !!lyW,
    previousAvailable: !!prevW,
    latestActualImsPeriod: periods[latestActualIdx] ? toPeriodRef(periods[latestActualIdx]) : null,
    currentPeriod: currentIdx >= 0 ? toPeriodRef(periods[currentIdx]) : null,
    availablePeriods: periods.map(toPeriodRef),
    filterOptions: filterOptions(ds.skus),
    skuCount: filteredSkus.length,
    activeSkuCountUnfiltered: ds.skus.length,
  };

  const headline = buildHeadline({
    country,
    windowLabel: wLabel,
    generatedAt: meta.generatedAt,
    runningRate,
    outlook,
    closingStock: closing,
    weeksOfCover: weeks,
    forecastAccuracyPct: accOverall.accuracyPct,
    stockoutRiskSkus: atRisk.length,
    overstockSkus: overstock.length,
    risks: risks.map((r) => ({ sku: r.sku, issue: r.issue, severity: r.severity })),
    series,
    periods,
  });

  return { meta, runningRate, outlook, executive: { tiles, keyMessages, risks }, flow, demand, supply, inventory, forecastQuality, forward, commercial, portfolio, market, anomalies, confidence, headline };
}

function latestUpdatedAt(ds: PerformanceDataset): string | null {
  let best: number | null = null;
  const consider = (v: Date | string | null | undefined) => {
    if (!v) return;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  };
  for (const r of ds.forecast) consider(r.updatedAt);
  for (const r of ds.ims) consider(r.updatedAt);
  for (const r of ds.shipment) consider(r.updatedAt);
  for (const r of ds.arrival) consider(r.updatedAt);
  for (const r of ds.planningFg) consider(r.updatedAt);
  for (const r of ds.clearanceEvents) consider(r.updatedAt);
  for (const r of ds.actualProduction) consider(r.updatedAt);
  return best === null ? null : new Date(best).toISOString();
}

// ── Section builders ─────────────────────────────────────────────────────────

function buildFlow(a: {
  intl: boolean; w: Window; series: SkuSeries[]; batches: Batch[]; periods: DatasetPeriod[]; now: Date;
  ims: number; imsPlan: number | null; production: number; productionPlan: number | null; arrivals: number; closing: number; monthlyDemand: number;
  delayed: FlowSection["delayedBatches"]; mIms: number[]; mArr: number[];
}): FlowSection {
  const { intl, w, series, batches, periods, now } = a;
  const notes: string[] = [];
  const opening = sumAt(series, w.fromIdx, (c) => c.opening) ?? 0;
  const adjustments = sumOver(series, w, (c) => c.adjustments) ?? 0;
  const windowBatches = batches.filter((b) => {
    const idx = periods.findIndex((p) => p.id === b.period.id);
    return idx >= w.fromIdx && idx <= w.toIdx && b.producedMc > 0;
  });
  const clearedOfWindow = sum(windowBatches.map((b) => Math.min(b.clearedMc, b.producedMc)));
  const pipelineOfWindow = sum(windowBatches.map((b) => b.pendingMc));

  const supply: WaterfallStep[] = [];
  const plan = a.productionPlan ?? 0;
  supply.push({ key: "plan", label: "Plan", value: round(plan), kind: "total", gapMc: null, gapPct: null });
  supply.push({ key: "notProduced", label: a.production - plan >= 0 ? "Produced above plan" : "Not produced", value: round(a.production - plan), kind: "delta", gapMc: round(a.production - plan), gapPct: pct(a.production, plan) });
  supply.push({ key: "produced", label: "Produced", value: round(a.production), kind: "total", gapMc: round(a.production - plan), gapPct: pct(a.production, plan) });
  if (intl) {
    supply.push({ key: "pipeline", label: "Still in transit / at port", value: round(-pipelineOfWindow), kind: "delta", gapMc: round(-pipelineOfWindow), gapPct: a.production > 0 ? round((-pipelineOfWindow / a.production) * 100, 1) : null, note: "Produced in the period but not cleared yet" });
    supply.push({ key: "cleared", label: "Cleared", value: round(clearedOfWindow), kind: "total", gapMc: round(clearedOfWindow - a.production), gapPct: pct(clearedOfWindow, a.production), note: "From this period's production batches" });
  } else {
    supply.push({ key: "arrivedGap", label: a.arrivals - a.production >= 0 ? "Arrived from earlier production" : "Not yet arrived", value: round(a.arrivals - a.production), kind: "delta", gapMc: round(a.arrivals - a.production), gapPct: pct(a.arrivals, a.production), note: "Arrivals in the period versus production in the period" });
    supply.push({ key: "arrived", label: "Arrived", value: round(a.arrivals), kind: "total", gapMc: round(a.arrivals - a.production), gapPct: pct(a.arrivals, a.production) });
  }

  const stock: WaterfallStep[] = [
    { key: "opening", label: "Opening stock", value: round(opening), kind: "total", gapMc: null, gapPct: null },
    { key: "arrivals", label: intl ? "Cleared arrivals" : "Arrivals", value: round(a.arrivals), kind: "delta", gapMc: round(a.arrivals), gapPct: opening > 0 ? round((a.arrivals / opening) * 100, 1) : null },
    { key: "sold", label: "Sold (IMS)", value: round(-a.ims), kind: "delta", gapMc: round(-a.ims), gapPct: opening > 0 ? round((-a.ims / opening) * 100, 1) : null },
  ];
  if (Math.abs(adjustments) >= 0.5) stock.push({ key: "adjustments", label: "Adjustments", value: round(adjustments), kind: "delta", gapMc: round(adjustments), gapPct: null });
  stock.push({ key: "closing", label: "Closing stock", value: round(a.closing), kind: "total", gapMc: round(a.closing - opening), gapPct: pct(a.closing, opening) });

  const weeksAt = (mc: number | null) => (mc === null ? null : a.monthlyDemand > 0 ? round((mc / a.monthlyDemand) * 4.33, 1) : null);
  const pipeline: PipelineStage[] = [];
  if (intl) {
    const byStatus = (statuses: string[]) => sum(batches.filter((b) => statuses.includes(b.status) && b.pendingMc > 0 && b.producedMc > 0 && (b.actualMc > 0 || new Date(b.period.year, b.period.month - 1, 1) <= now)).map((b) => b.pendingMc));
    const inProduction = byStatus(["Pending"]);
    const inTransit = byStatus(["In Transit"]);
    const atPort = byStatus(["Arrived", "Partially Cleared"]);
    pipeline.push({ key: "production", label: "Produced, awaiting shipment", mc: round(inProduction), weeksOfCover: weeksAt(inProduction) });
    pipeline.push({ key: "transit", label: "In transit", mc: round(inTransit), weeksOfCover: weeksAt(inTransit) });
    pipeline.push({ key: "port", label: "At port, awaiting clearance", mc: round(atPort), weeksOfCover: weeksAt(atPort) });
    pipeline.push({ key: "stock", label: "In market (closing stock)", mc: round(a.closing), weeksOfCover: weeksAt(a.closing) });
    notes.push("Pipeline stages follow the batch status set on the Arrival page; quantities are produced minus cleared.");
  } else {
    const next3 = periods.slice(w.toIdx + 1, w.toIdx + 4);
    const plannedProd = sum(next3.map((p) => sumAt(series, periods.indexOf(p), (c) => c.production) ?? 0));
    const plannedArr = sum(next3.map((p) => sumAt(series, periods.indexOf(p), (c) => (c.arrivals !== 0 ? c.arrivals : c.plannedArrivals)) ?? 0));
    pipeline.push({ key: "production", label: "Production planned, next 3 months", mc: round(plannedProd), weeksOfCover: weeksAt(plannedProd) });
    pipeline.push({ key: "arrivals", label: "Arrivals planned, next 3 months", mc: round(plannedArr), weeksOfCover: weeksAt(plannedArr) });
    pipeline.push({ key: "stock", label: "In market (closing stock)", mc: round(a.closing), weeksOfCover: weeksAt(a.closing) });
    notes.push("Lebanon does not track transit or customs status; the pipeline shows planned production and arrivals.");
  }
  notes.push("Weeks of cover in the pipeline use the average of the last 3 months of actual sell-out.");

  const leadTimes: LeadTimeStat[] = [];
  const stat = (label: string, samples: { days: number; label: string }[], note?: string): LeadTimeStat => {
    const byMonth = new Map<string, number[]>();
    for (const s of samples) {
      if (!byMonth.has(s.label)) byMonth.set(s.label, []);
      byMonth.get(s.label)!.push(s.days);
    }
    const trend = periods.slice(Math.max(0, w.toIdx - 11), w.toIdx + 1).map((p) => {
      const xs = byMonth.get(shortLabel(p)) ?? [];
      return { label: shortLabel(p), value: xs.length ? round(sum(xs) / xs.length) : null };
    });
    const days = samples.map((s) => s.days);
    return {
      label,
      avgDays: days.length ? round(sum(days) / days.length) : null,
      minDays: days.length ? Math.min(...days) : null,
      maxDays: days.length ? Math.max(...days) : null,
      sampleSize: days.length,
      trend,
      note: days.length ? note : note ?? "No data yet",
    };
  };
  if (intl) {
    const prodStart = (b: Batch) => new Date(b.period.year, b.period.month - 1, 1);
    leadTimes.push(stat("Production → clearance (actual)", batches.filter((b) => b.firstClearedDate).map((b) => ({ days: daysBetween(prodStart(b), b.firstClearedDate!), label: shortLabel(b.period) })), "Measured from the 1st of the production month to the first clearance"));
    leadTimes.push(stat("Planned transit (arrival offset)", batches.filter((b) => b.expectedArrival).map((b) => ({ days: daysBetween(prodStart(b), b.expectedArrival!), label: shortLabel(b.period) })), "From the arrival offset entered per batch"));
    leadTimes.push(stat("Expected arrival → clearance", batches.filter((b) => b.expectedArrival && b.firstClearedDate).map((b) => ({ days: daysBetween(b.expectedArrival!, b.firstClearedDate!), label: shortLabel(b.period) })), "Days between the expected arrival date and the first clearance"));
  } else {
    leadTimes.push({ label: "Production → arrival", avgDays: null, minDays: null, maxDays: null, sampleSize: 0, trend: [], note: "Lebanon arrivals are entered by month without dates, so lead times are not tracked" });
  }

  return { waterfall: { supply, stock }, pipeline, leadTimes, delayedBatches: a.delayed, notes };
}

function buildDemand(a: { series: SkuSeries[]; periods: DatasetPeriod[]; w: Window; lyW: Window | null; prevW: Window | null; chartW: Window; mIms: number[]; mImsActual: (number | null)[]; mPlan: number[] }): Omit<DemandSection, "bridge"> {
  const { series, periods, w, lyW, chartW, mIms, mImsActual, mPlan } = a;
  const notes: string[] = [];
  const lyValue = (i: number): number | null => {
    const p = periods[i];
    const j = monthIndexOf(periods, p.year - 1, p.month);
    return j >= 0 ? mIms[j] : null;
  };
  const monthly: DemandMonth[] = [];
  for (let i = chartW.fromIdx; i <= chartW.toIdx; i++) {
    const auto = series.some((s) => s.months[i].ims !== 0 && s.months[i].imsSource === "auto_forecast");
    const actual = mImsActual[i] !== null;
    monthly.push({
      label: shortLabel(periods[i]),
      ims: mIms[i] !== 0 || actual ? round(mIms[i]) : null,
      plan: round(mPlan[i]),
      lastYear: lyValue(i) === null ? null : round(lyValue(i) as number),
      runningRate3: runningRate(mImsActual, i, 3),
      runningRate6: runningRate(mImsActual, i, 6),
      autoFilled: auto,
      isActual: actual,
    });
  }
  const yoy: YoyMonth[] = [];
  {
    const year = periods[w.toIdx].year;
    let cumC = 0;
    let cumL = 0;
    let anyLy = false;
    for (let m = 1; m <= periods[w.toIdx].month; m++) {
      const i = monthIndexOf(periods, year, m);
      const j = monthIndexOf(periods, year - 1, m);
      const c = i >= 0 ? mIms[i] : null;
      const l = j >= 0 ? mIms[j] : null;
      if (c !== null) cumC += c;
      if (l !== null) {
        cumL += l;
        anyLy = true;
      }
      yoy.push({
        label: `${shortLabel({ year, month: m })}`,
        current: c === null ? null : round(c),
        lastYear: l === null ? null : round(l),
        growthPct: c !== null && l !== null ? pct(c, l) : null,
        cumulativeCurrent: round(cumC),
        cumulativeLastYear: anyLy ? round(cumL) : null,
        cumulativeGrowthPct: anyLy ? pct(cumC, cumL) : null,
      });
    }
    if (!anyLy) notes.push("No prior year data for year-on-year comparison.");
  }
  const seasonality = seasonalityIndex(periods, mImsActual);
  if (seasonality.every((s) => s.yearsUsed < 2)) notes.push("Seasonality index uses fewer than two years of data; treat as indicative.");

  const groupSum = (win: Window | null, groupOf: (s: SkuSeries) => string) => {
    const m = new Map<string, number>();
    if (!win) return m;
    for (const s of series) {
      let t = 0;
      for (let i = win.fromIdx; i <= win.toIdx; i++) t += s.months[i].ims;
      m.set(groupOf(s), (m.get(groupOf(s)) ?? 0) + t);
    }
    return m;
  };
  const mixFor = (dimension: MixDimension["dimension"], title: string, groupOf: (s: SkuSeries) => string): MixDimension => {
    const cur = groupSum(w, groupOf);
    const ly = groupSum(lyW, groupOf);
    const total = sum(Array.from(cur.values()));
    const totalLy = sum(Array.from(ly.values()));
    const rows = Array.from(cur.entries())
      .map(([group, mc]) => {
        const share = total > 0 ? (mc / total) * 100 : 0;
        const lyShare = totalLy > 0 ? ((ly.get(group) ?? 0) / totalLy) * 100 : null;
        return { group, mc: round(mc), sharePct: round(share, 1), lastYearSharePct: lyShare === null ? null : round(lyShare, 1), shiftPts: lyShare === null ? null : round(share - lyShare, 1) };
      })
      .sort((x, y) => y.mc - x.mc);
    return { dimension, title, rows };
  };
  const mix = [
    mixFor("weight", "Which pack sizes drive sales?", (s) => s.sku.weight),
    mixFor("category", "Core versus new products", (s) => s.sku.category ?? "Core"),
    mixFor("packaging", "Old versus new packaging", (s) => s.sku.packagingType ?? "New"),
    mixFor("flavour", "Which flavours sell most?", (s) => flavourOf(s.sku)),
  ];

  const skuTotals = series.map((s) => ({ sku: s.sku.name, weight: s.sku.weight, mc: sumOver([s], w, (c) => c.ims) ?? 0 }));
  const pareto = paretoRows(skuTotals);

  const basis: "ly" | "prev" = lyW ? "ly" : "prev";
  const refW = lyW ?? a.prevW;
  const movers = topMovers(series.map((s) => ({ sku: s.sku.name, weight: s.sku.weight, current: sumOver([s], w, (c) => c.ims) ?? 0, reference: refW ? sumOver([s], refW, (c) => c.ims) ?? 0 : 0 })));
  if (!refW) notes.push("Growers and decliners need a prior year or previous period to compare against.");

  const isNpi = (s: SkuSeries) => (s.sku.category ?? "Core") !== "Core";
  const coreMc = sum(series.filter((s) => !isNpi(s)).map((s) => sumOver([s], w, (c) => c.ims) ?? 0));
  const npiMc = sum(series.filter(isNpi).map((s) => sumOver([s], w, (c) => c.ims) ?? 0));
  const tot = coreMc + npiMc;
  const byMonth = [];
  for (let i = chartW.fromIdx; i <= chartW.toIdx; i++) {
    const c = sum(series.filter((s) => !isNpi(s)).map((s) => s.months[i].ims));
    const n = sum(series.filter(isNpi).map((s) => s.months[i].ims));
    const t = c + n;
    byMonth.push({ label: shortLabel(periods[i]), corePct: t > 0 ? round((c / t) * 100, 1) : null, npiPct: t > 0 ? round((n / t) * 100, 1) : null });
  }
  const ramps = series.filter(isNpi).map((s) => {
    const first = s.months.findIndex((c) => c.ims > 0 && c.imsIsActual);
    const rampCells = first >= 0 ? s.months.slice(first, Math.min(s.months.length, w.toIdx + 1)).filter((c) => !c.isFuture) : [];
    return {
      sku: s.sku.name,
      weight: s.sku.weight,
      launchMonth: first >= 0 ? shortLabel(s.months[first].period) : null,
      monthsSinceLaunch: rampCells.length,
      ramp: rampCells.map((c, k) => ({ label: `M${k + 1}`, value: round(c.ims) })),
      totalMc: round(sumOver([s], w, (c) => c.ims) ?? 0),
    };
  });

  return {
    monthly,
    yoy,
    seasonality,
    mix,
    pareto,
    growers: movers.growers,
    decliners: movers.decliners,
    moversBasis: basis,
    npi: { coreSharePct: tot > 0 ? round((coreMc / tot) * 100, 1) : null, npiSharePct: tot > 0 ? round((npiMc / tot) * 100, 1) : null, byMonth, ramps },
    notes,
  };
}

function buildSupply(a: { intl: boolean; series: SkuSeries[]; periods: DatasetPeriod[]; chartW: Window; w: Window; batches: Batch[]; now: Date; mPlan: number[]; mProd: number[]; mIms: number[]; mArr: number[]; mPlannedArr: number[] }): SupplySection {
  const { intl, periods, chartW, batches, now, mPlan, mProd, mIms, mArr, mPlannedArr } = a;
  const notes: string[] = [];
  const attainment: AttainmentMonth[] = [];
  let cp = 0;
  let ca = 0;
  for (let i = chartW.fromIdx; i <= chartW.toIdx; i++) {
    cp += mPlan[i];
    ca += mProd[i];
    attainment.push({ label: shortLabel(periods[i]), plan: round(mPlan[i]), actual: round(mProd[i]), attainmentPct: mPlan[i] > 0 ? round((mProd[i] / mPlan[i]) * 100, 1) : null, cumulativePlan: round(cp), cumulativeActual: round(ca) });
  }
  const cumulative = [];
  let cProd = 0;
  let cIms = 0;
  for (let i = chartW.fromIdx; i <= chartW.toIdx; i++) {
    cProd += mProd[i];
    cIms += mIms[i];
    cumulative.push({ label: shortLabel(periods[i]), cumulativeProduction: round(cProd), cumulativeIms: round(cIms), gap: round(cProd - cIms) });
  }
  const arrivals = [];
  for (let i = chartW.fromIdx; i <= chartW.toIdx; i++) arrivals.push({ label: shortLabel(periods[i]), planned: round(mPlannedArr[i]), actual: round(mArr[i]), variance: round(mArr[i] - mPlannedArr[i]) });

  let onTimePct: number | null = null;
  let onTimeNote = "On-time = first clearance within 14 days of the expected arrival date.";
  let clearance: SupplySection["clearance"] = null;
  if (intl) {
    const graceDays = 14;
    const due = batches.filter((b) => b.expectedArrival && b.producedMc > 0 && (b.firstClearedDate || daysBetween(b.expectedArrival, now) > graceDays));
    const onTime = due.filter((b) => b.firstClearedDate && daysBetween(b.expectedArrival!, b.firstClearedDate) <= graceDays);
    onTimePct = due.length ? round((onTime.length / due.length) * 100, 1) : null;
    if (!due.length) onTimeNote = "No batches with an expected arrival date have come due yet.";
    const recent = batches.filter((b) => {
      const idx = periods.findIndex((p) => p.id === b.period.id);
      return idx >= chartW.fromIdx && idx <= chartW.toIdx && b.producedMc > 0;
    });
    const clearedMc = sum(recent.map((b) => Math.min(b.clearedMc, b.producedMc)));
    const pendingMc = sum(recent.map((b) => b.pendingMc));
    const statusMap = new Map<string, { batches: number; mc: number }>();
    for (const b of recent) {
      const e = statusMap.get(b.status) ?? { batches: 0, mc: 0 };
      e.batches += 1;
      e.mc += b.producedMc;
      statusMap.set(b.status, e);
    }
    const pendingBatches = batches.filter((b) => b.pendingMc > 0 && b.producedMc > 0 && new Date(b.period.year, b.period.month - 1, 1) <= now).sort((x, y) => x.period.sortOrder - y.period.sortOrder);
    const oldest = pendingBatches[0];
    const daysToClear = batches.filter((b) => b.firstClearedDate).map((b) => daysBetween(new Date(b.period.year, b.period.month - 1, 1), b.firstClearedDate!)).sort((x, y) => x - y);
    clearance = {
      clearedMc: round(clearedMc),
      pendingMc: round(pendingMc),
      clearanceRatePct: clearedMc + pendingMc > 0 ? round((clearedMc / (clearedMc + pendingMc)) * 100, 1) : null,
      batchStatus: Array.from(statusMap.entries()).map(([status, v]) => ({ status, batches: v.batches, mc: round(v.mc) })),
      oldestPending: oldest ? { sku: oldest.sku.name, productionPeriod: oldest.period.label, pendingMc: round(oldest.pendingMc), daysWaiting: oldest.expectedArrival ? daysBetween(oldest.expectedArrival, now) : daysBetween(new Date(oldest.period.year, oldest.period.month - 1, 1), now) } : null,
      avgDaysToClear: daysToClear.length ? round(sum(daysToClear) / daysToClear.length) : null,
      medianDaysToClear: daysToClear.length ? daysToClear[Math.floor(daysToClear.length / 2)] : null,
    };
    notes.push("Clearance figures cover batches produced in the chart window; days to clear are measured from the 1st of the production month.");
  } else {
    onTimeNote = "Lebanon arrivals are entered by month without dates, so on-time delivery is not tracked.";
    notes.push("Planned arrivals = forecast production shifted by the arrival offset entered on the Arrival sheet.");
  }
  return { attainment, cumulative, arrivals, onTimePct, onTimeNote, clearance, notes };
}

function buildInventory(a: {
  intl: boolean; series: SkuSeries[]; periods: DatasetPeriod[]; w: Window; projRows: ReturnType<typeof projectionInputs>;
  coverRows: InventorySection["cover"]; atRisk: InventorySection["atRisk"]; overstock: InventorySection["overstock"];
  expiryRows: ReturnType<typeof expiryAtRisk>; filteredSkus: PerformanceDataset["skus"]; rule: ReturnType<typeof coverRuleFor>;
}): Omit<InventorySection, "lostSales" | "efficiency"> {
  const { intl, w, projRows, coverRows, atRisk, overstock, expiryRows, filteredSkus, rule } = a;
  const notes: string[] = [];
  const zoneOrder: InventorySection["zoneCounts"][number]["zone"][] = ["Negative", "Out of Stock", "Critical", "Healthy", "Overstock"];
  const zoneCounts = zoneOrder.map((zone) => ({ zone, count: coverRows.filter((c) => c.zone === zone).length }));
  const months = projRows[0]?.labels ?? [];
  const rows = projRows.map((row) => {
    const p = projectSku({ skuId: row.sku.id, sku: row.sku.name, weight: row.sku.weight, openingStock: row.openingStock, demand: row.demand, arrivals: row.arrivals }, 1, rule);
    return {
      sku: row.sku.name,
      weight: row.sku.weight,
      cells: p.map((m, i) => ({ label: row.labels[i], weeks: m.weeks === null ? null : round(m.weeks, 1), zone: classifyZone(m.weeks, m.closing), closing: round(m.closing) })),
    };
  });
  const priceOf = new Map(filteredSkus.map((s) => [s.id, s.priceToWs ? num(s.priceToWs) : null]));
  let valueUsd = 0;
  let pricedMc = 0;
  let unpricedMc = 0;
  const missing: string[] = [];
  for (const s of a.series) {
    const c = Math.max(0, s.months[w.toIdx].closing);
    const price = priceOf.get(s.sku.id) ?? null;
    if (price && price > 0) {
      valueUsd += c * price;
      pricedMc += c;
    } else {
      unpricedMc += c;
      missing.push(s.sku.name);
    }
  }
  const anyPrice = pricedMc > 0 || Array.from(priceOf.values()).some((p) => p && p > 0);
  if (!anyPrice) notes.push("No wholesale prices are set for these SKUs, so stock value cannot be shown.");
  if (intl) notes.push("Projected months add expected arrivals from planned production; Planning FG itself only counts cleared arrivals.");
  notes.push("Weeks of cover use the same rule as the Planning FG page; the 4–6 week band is the target.");
  return {
    targetWeeks: { low: 4, high: 6 },
    coverFormula: intl ? "Closing stock ÷ same-month IMS × 4" : "Closing stock ÷ average of the next two months' IMS × 4.3",
    cover: [...coverRows].sort((x, y) => (x.weeks ?? 999) - (y.weeks ?? 999)),
    zoneCounts,
    heatmap: { months, rows },
    atRisk,
    overstock,
    expiryRisk: intl ? { rows: expiryRows, totalAtRiskMc: round(sum(expiryRows.map((r) => r.atRiskMc))) } : null,
    stockValue: {
      valueUsd: anyPrice ? round(valueUsd) : null,
      pricedMc: round(pricedMc),
      unpricedMc: round(unpricedMc),
      pricedSharePct: pricedMc + unpricedMc > 0 ? round((pricedMc / (pricedMc + unpricedMc)) * 100, 1) : null,
      skusMissingPrice: missing,
    },
    notes,
  };
}

function buildForecastQuality(a: { series: SkuSeries[]; chartW: Window; w: Window; chronic: ForecastQualitySection["chronic"]; acc: ReturnType<typeof accuracySamples>; accOverall: ReturnType<typeof accuracyOf> }): ForecastQualitySection {
  const chartSamples = accuracySamples(a.series, a.chartW);
  const order = a.chartW.months.map(shortLabel);
  const notes: string[] = [];
  if (a.acc.samples.length === 0) notes.push("No months with actual IMS in this period, so accuracy cannot be measured yet.");
  return {
    overallAccuracyPct: a.accOverall.accuracyPct,
    overallBiasPct: a.accOverall.biasPct,
    byMonth: accuracyByMonth(chartSamples.samples, order),
    byWeight: accuracyByGroup(a.acc.samples, (s) => s.weight),
    bySku: accuracyByGroup(a.acc.samples, (s) => s.sku, (s) => s.weight),
    chronic: a.chronic,
    excludedAutoFilledMonths: a.acc.excludedAutoFilled,
    method: "Accuracy = 1 − (sum of absolute errors ÷ actual sales). Bias = (forecast − actual) ÷ actual; positive means over-forecast. Only months with human-entered IMS count.",
    notes,
  };
}

function buildForward(a: { intl: boolean; series: SkuSeries[]; periods: DatasetPeriod[]; w: Window; projRows: ReturnType<typeof projectionInputs>; horizonLabels: string[]; batches: Batch[]; ds: PerformanceDataset; rule: ReturnType<typeof coverRuleFor>; currentIdx: number }): ForwardSection {
  const { intl, projRows, horizonLabels, batches, ds, rule, periods, w } = a;
  const notes: string[] = [];
  const inputs = projRows.map((r) => ({ skuId: r.sku.id, sku: r.sku.name, weight: r.sku.weight, openingStock: round(r.openingStock), demand: r.demand.map((v) => round(v)), arrivals: r.arrivals.map((v) => round(v)), production: r.production.map((v) => round(v)) }));
  const toMonths = (rows: typeof inputs): ForwardMonth[] => aggregateProjection(rows, 1, rule).map((m, i) => ({ label: horizonLabels[i], demand: round(m.demand), arrivals: round(m.arrivals), closing: round(m.closing), weeks: m.weeks === null ? null : round(m.weeks, 1), targetLowMc: round(m.targetLowMc), targetHighMc: round(m.targetHighMc) }));
  const total = toMonths(inputs);
  const weights = Array.from(new Set(inputs.map((i) => i.weight)));
  const byWeight = weights.map((weight) => ({ weight, months: toMonths(inputs.filter((i) => i.weight === weight)) }));

  // Lead time for order timing
  let leadTimeMonths = 1;
  let leadTimeNote = "";
  if (intl) {
    const observed = batches.filter((b) => b.firstClearedDate).map((b) => daysBetween(new Date(b.period.year, b.period.month - 1, 1), b.firstClearedDate!)).sort((x, y) => x - y);
    const offsets = batches.filter((b) => b.expectedArrival).map((b) => daysBetween(new Date(b.period.year, b.period.month - 1, 1), b.expectedArrival!));
    if (observed.length >= 3) {
      const median = observed[Math.floor(observed.length / 2)];
      leadTimeMonths = Math.max(1, Math.round(median / 30));
      leadTimeNote = `Median observed production-to-clearance time is ${median} days (${observed.length} batches).`;
    } else if (offsets.length) {
      const avg = sum(offsets) / offsets.length;
      leadTimeMonths = Math.max(1, Math.round(avg / 30));
      leadTimeNote = `Based on the average arrival offset of ${round(avg)} days.`;
    } else {
      leadTimeNote = "No lead-time data yet; assuming one month from production to clearance.";
    }
  } else {
    const offs = ds.arrival.map((r) => r.arrivalOffsetWeeks ?? 0).filter((v) => v > 0);
    const avgWeeks = offs.length ? sum(offs) / offs.length : 0;
    leadTimeMonths = Math.round(avgWeeks / 4.33);
    leadTimeNote = offs.length ? `Based on the average arrival offset of ${round(avgWeeks, 1)} weeks.` : "No arrival offsets entered; assuming arrivals land in the production month.";
  }

  const horizonEnd = horizonLabels.length - 1;
  const gaps: GapRow[] = [];
  if (horizonEnd >= 0) {
    for (const r of inputs) {
      const p = projectSku(r, 1, rule);
      const last = p[horizonEnd];
      const target = mcForWeeks(5, r.demand, horizonEnd, rule);
      const gap = target - last.closing;
      const demandAvg = r.demand.length ? sum(r.demand) / r.demand.length : 0;
      const threshold = Math.max(5, demandAvg * 0.1);
      const action: GapRow["action"] = gap > threshold ? "add" : gap < -threshold ? "cut" : "hold";
      const horizonPeriodIdx = w.toIdx + 1 + horizonEnd;
      const orderIdx = horizonPeriodIdx - leadTimeMonths;
      let orderByMonth: string | null = null;
      if (action !== "hold") {
        if (orderIdx <= (a.currentIdx >= 0 ? a.currentIdx : w.toIdx)) orderByMonth = "Now";
        else if (periods[orderIdx]) orderByMonth = shortLabel(periods[orderIdx]);
      }
      gaps.push({ sku: r.sku, weight: r.weight, horizonMonth: horizonLabels[horizonEnd], projectedClosing: round(last.closing), targetClosing: round(target), gapMc: round(gap), action, orderByMonth });
    }
  }
  gaps.sort((x, y) => Math.abs(y.gapMc) - Math.abs(x.gapMc));
  if (!horizonLabels.length) notes.push("No future months exist in the planning periods — add a year to project forward.");
  notes.push("Demand = entered IMS where available, otherwise the forecast. Target = 5 weeks of cover (middle of the 4–6 band).");
  if (intl) notes.push("Arrivals include planned production batches landing per their arrival offset; overdue batches are assumed to land in the first projected month.");

  return { horizonMonths: horizonLabels, total, byWeight, gaps, inputs: { months: horizonLabels, cover: rule, target: { low: 4, high: 6 }, leadTimeMonths, leadTimeNote, skus: inputs }, notes };
}

function buildCommercial(a: { series: SkuSeries[]; w: Window; lyW: Window | null; filteredSkus: PerformanceDataset["skus"] }): CommercialSection {
  const { series, w, lyW, filteredSkus } = a;
  const priceOf = new Map(filteredSkus.map((s) => [s.id, s.priceToWs ? num(s.priceToWs) : 0]));
  const hasPrices = Array.from(priceOf.values()).some((p) => p > 0);
  const notes: string[] = [];
  const missing = filteredSkus.filter((s) => !(priceOf.get(s.id)! > 0)).map((s) => s.name);
  if (!hasPrices) {
    notes.push("No wholesale prices (price to WS) are set for these SKUs. Enter prices in SKU Management to see values in dollars.");
    return { hasPrices: false, selloutUsd: null, selloutLyUsd: null, stockUsd: null, pricedVolumeSharePct: null, byWeight: [], byCategory: [], skusMissingPrice: missing, notes };
  }
  const rowFor = (group: string, xs: SkuSeries[]): CommercialRow => {
    let sell = 0;
    let sellLy = 0;
    let stock = 0;
    let pricedMc = 0;
    let totalMc = 0;
    let anyLy = false;
    for (const s of xs) {
      const price = priceOf.get(s.sku.id) ?? 0;
      const mc = sumOver([s], w, (c) => c.ims) ?? 0;
      totalMc += mc;
      if (price <= 0) continue;
      pricedMc += mc;
      sell += mc * price;
      stock += Math.max(0, s.months[w.toIdx].closing) * price;
      if (lyW) {
        anyLy = true;
        sellLy += (sumOver([s], lyW, (c) => c.ims) ?? 0) * price;
      }
    }
    return {
      group,
      selloutUsd: round(sell),
      selloutLyUsd: anyLy ? round(sellLy) : null,
      selloutGrowthPct: anyLy ? pct(sell, sellLy) : null,
      stockUsd: round(stock),
      pricedSharePct: totalMc > 0 ? round((pricedMc / totalMc) * 100, 1) : null,
    };
  };
  const all = rowFor("Total", series);
  const weights = Array.from(new Set(series.map((s) => s.sku.weight)));
  const cats = Array.from(new Set(series.map((s) => s.sku.category ?? "Core")));
  if (missing.length) notes.push(`${missing.length} SKU(s) have no price and are excluded from dollar values.`);
  notes.push("Values use our selling price to wholesale ($/MC) from SKU Management; no prices are estimated.");
  return {
    hasPrices: true,
    selloutUsd: all.selloutUsd,
    selloutLyUsd: all.selloutLyUsd,
    stockUsd: all.stockUsd,
    pricedVolumeSharePct: all.pricedSharePct,
    byWeight: weights.map((wt) => rowFor(wt, series.filter((s) => s.sku.weight === wt))),
    byCategory: cats.map((c) => rowFor(c, series.filter((s) => (s.sku.category ?? "Core") === c))),
    skusMissingPrice: missing,
    notes,
  };
}

function buildConfidence(a: {
  ds: PerformanceDataset; series: SkuSeries[]; filteredSeries: SkuSeries[]; periods: DatasetPeriod[]; w: Window; currentIdx: number; latestActualIdx: number;
  reconciliationSource: { id: number; name: string; weight: string; closingStock: number }[] | null; horizon: number;
}): DataConfidenceSection {
  const { ds, series, filteredSeries, periods, w, currentIdx, latestActualIdx, reconciliationSource, horizon } = a;
  const issues: ConfidenceIssue[] = [];

  // Missing IMS months: after a SKU's first actual sale, up to the latest actual month.
  const missingImsMonths = filteredSeries
    .map((s) => {
      const first = s.months.findIndex((c) => c.imsIsActual);
      if (first < 0) return null;
      const months: string[] = [];
      for (let i = first; i <= latestActualIdx; i++) if (s.months[i].ims === 0) months.push(shortLabel(s.months[i].period));
      return months.length ? { sku: s.sku.name, weight: s.sku.weight, months } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const missingCount = sum(missingImsMonths.map((m) => m.months.length));
  if (missingCount) issues.push({ severity: missingCount > 10 ? "red" : "amber", title: "Months without IMS", detail: `${missingCount} SKU-month(s) have no sell-out entered after the product started selling.`, count: missingCount });

  const skusWithoutForecast = filteredSeries
    .filter((s) => !s.months.slice(w.fromIdx, Math.min(s.months.length, w.toIdx + 1 + horizon)).some((c) => c.forecast > 0))
    .map((s) => ({ sku: s.sku.name, weight: s.sku.weight }));
  if (skusWithoutForecast.length) issues.push({ severity: "amber", title: "SKUs without a forecast", detail: `${skusWithoutForecast.length} SKU(s) have no forecast in the period or the next ${horizon} months.`, count: skusWithoutForecast.length });

  const autoAll = filteredSeries.reduce((n, s) => n + s.months.filter((c) => c.ims !== 0 && c.imsSource === "auto_forecast").length, 0);
  const autoPast = filteredSeries.reduce((n, s) => n + s.months.filter((c) => c.ims !== 0 && c.imsSource === "auto_forecast" && !c.isFuture).length, 0);
  if (autoAll) issues.push({ severity: autoPast ? "amber" : "grey", title: "Auto-filled IMS", detail: `${autoAll} IMS month(s) were auto-filled from the forecast${autoPast ? `, ${autoPast} of them in months that should now hold actual sales` : ""}.`, count: autoAll });

  const skusMissingPrice = filteredSeries.filter((s) => !(num(s.sku.priceToWs) > 0)).map((s) => s.sku.name);
  if (skusMissingPrice.length) issues.push({ severity: "grey", title: "SKUs without a wholesale price", detail: `${skusMissingPrice.length} SKU(s) have no price to WS, so dollar values exclude them.`, count: skusMissingPrice.length });

  const latest = (rows: { updatedAt?: Date | string | null }[]): string | null => {
    let best: number | null = null;
    for (const r of rows) {
      if (!r.updatedAt) continue;
      const t = r.updatedAt instanceof Date ? r.updatedAt.getTime() : new Date(r.updatedAt).getTime();
      if (Number.isFinite(t) && (best === null || t > best)) best = t;
    }
    return best === null ? null : new Date(best).toISOString();
  };
  const intl = isIntlCountry(ds.country);
  const freshness = [
    { sheet: intl ? "Forecast Production" : "Forecast", lastUpdated: latest(ds.forecast) },
    { sheet: "IMS", lastUpdated: latest(ds.ims) },
    { sheet: intl ? "Production" : "Shipment (Production)", lastUpdated: latest([...ds.shipment, ...ds.actualProduction]) },
    { sheet: intl ? "Arrival / clearance" : "Arrival", lastUpdated: latest(intl ? ds.clearanceEvents : ds.arrival) },
    { sheet: "Planning FG", lastUpdated: latest(ds.planningFg) },
  ];

  // Reconciliation against the independent current-month closing-stock calculation used by the Closing Stock tab.
  let reconciliation: DataConfidenceSection["reconciliation"];
  if (currentIdx < 0 || !reconciliationSource) {
    reconciliation = { month: null, ok: true, checkedSkus: 0, mismatches: [], note: "The current calendar month is not in the planning periods, so the cross-check was skipped." };
  } else {
    const mismatches = [];
    let checked = 0;
    for (const s of series) {
      const src = reconciliationSource.find((r) => r.id === s.sku.id);
      if (!src) continue;
      checked++;
      const packClosing = round(s.months[currentIdx].closing);
      const diff = packClosing - src.closingStock;
      if (Math.abs(diff) >= 1) mismatches.push({ sku: s.sku.name, weight: s.sku.weight, packClosing, planningFgClosing: src.closingStock, difference: round(diff) });
    }
    reconciliation = {
      month: periods[currentIdx].label,
      ok: mismatches.length === 0 && checked > 0,
      checkedSkus: checked,
      mismatches,
      note: mismatches.length === 0 ? `Closing stock for ${periods[currentIdx].label} matches Planning FG for all ${checked} SKUs.` : `${mismatches.length} SKU(s) differ from Planning FG — check the Planning FG page before presenting.`,
    };
    if (mismatches.length) issues.push({ severity: "red", title: "Closing stock does not reconcile", detail: reconciliation.note, count: mismatches.length });
  }

  const { score, grade } = confidenceScore({ missingImsMonths: missingCount, skusWithoutForecast: skusWithoutForecast.length, autoFilledPastMonths: autoPast, skusMissingPrice: skusMissingPrice.length, totalSkus: filteredSeries.length, reconciliationOk: reconciliation.ok });
  if (!issues.length) issues.push({ severity: "green", title: "No data issues found", detail: "All checks passed for the SKUs in scope.", count: 0 });
  return { score, grade, issues, missingImsMonths, skusWithoutForecast, autoFilledImsMonths: autoAll, skusMissingPrice, freshness, reconciliation };
}
