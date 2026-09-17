/**
 * Pure helpers for the Country Performance pack.
 *
 * Everything in this file is deterministic and DB-free so it can be unit
 * tested with fixtures. The orchestrator (countryPerformance.ts) loads the
 * rows and passes them in as a `PerformanceDataset`.
 *
 * IMPORTANT — closing stock replica
 * `buildSkuSeries` re-implements the Planning FG closing-stock chain for each
 * country exactly (see PlanningFgPage.tsx / IntlPlanningFgPage.tsx):
 *   closing = opening + adjustments + arrivals − IMS
 *   - opening of the first period = stored openingStock; afterwards = previous closing
 *   - Lebanon IMS = raw IMS, or forecast when the month is strictly in the future and raw IMS is 0
 *   - Syria/Libya/KSA IMS = raw IMS (including auto-filled rows)
 *   - Lebanon arrivals = Planning FG arrivals when non-zero, else Arrival sheet weekly total
 *   - Syria/Libya/KSA arrivals = clearance events bucketed by cleared-date month
 * Do not "improve" these rules here; the Data Confidence section checks that
 * the pack reconciles with the Planning FG numbers.
 */

import {
  classifyZone,
  coverRuleFor,
  findStockout,
  mcForWeeks,
  projectSku,
  weeksOfCoverAt,
  type CoverRule,
  type CoverZone,
} from "../../shared/performance/projection";
import type {
  AccuracyGroup,
  AccuracyPoint,
  ChronicSku,
  CompareMode,
  Delta,
  KeyMessage,
  Mover,
  ParetoRow,
  PerformanceCountry,
  PerformanceFilters,
  PeriodPreset,
  PeriodRef,
  Rag,
  RiskItem,
  SeasonalityPoint,
  SparkPoint,
} from "./countryPerformance.types";

// ── Dataset shapes (loosely typed so fixtures stay small) ────────────────────

export interface DatasetSku {
  id: number;
  name: string;
  weight: string;
  category: string | null;
  packagingType?: string | null;
  priceToWs?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface DatasetPeriod {
  id: number;
  year: number;
  month: number;
  label: string;
  sortOrder: number;
}

export interface ValueRow {
  skuId: number;
  periodId: number;
  value: string | null;
  source?: string | null;
  updatedAt?: Date | string | null;
}

export interface WeeklyRow {
  skuId: number;
  periodId: number;
  week1: string | null;
  week2: string | null;
  week3: string | null;
  week4: string | null;
  updatedAt?: Date | string | null;
}

export interface ShipmentRow extends WeeklyRow {
  arrivalOffsetValue?: number | null;
  arrivalOffsetUnit?: string | null;
  arrivalStatus?: string | null;
  clearedQty?: string | null;
  clearedDate?: string | Date | null;
  pendingClearDate?: string | Date | null;
  note?: string | null;
  invoiceRef?: string | null;
  containerRef?: string | null;
}

export interface ArrivalRow extends WeeklyRow {
  arrivalOffsetWeeks?: number | null;
}

export interface PlanningRow {
  skuId: number;
  periodId: number;
  openingStock: string | null;
  adjustments: string | null;
  invoiced?: string | null;
  arrivals: string | null;
  updatedAt?: Date | string | null;
}

export interface ClearanceRow {
  id?: number;
  skuId: number;
  periodId: number;
  clearedQty: string | number | null;
  clearedDate: string | Date | null;
  pendingClearDate?: string | Date | null;
  notes?: string | null;
  invoiceRef?: string | null;
  containerRef?: string | null;
  updatedAt?: Date | string | null;
}

export interface ExpiryRowLike {
  skuId: number;
  skuName: string;
  weight: string;
  productionPeriodLabel: string;
  productionDate: string;
  expiryDate: string;
  totalRemaining: number;
  monthsUntilExpiry: number;
}

export interface PerformanceDataset {
  country: PerformanceCountry;
  skus: DatasetSku[];
  periods: DatasetPeriod[];
  forecast: ValueRow[];
  ims: ValueRow[];
  shipment: ShipmentRow[];
  arrival: ArrivalRow[];
  planningFg: PlanningRow[];
  clearanceEvents: ClearanceRow[];
  actualProduction: ValueRow[];
  expiryRows?: ExpiryRowLike[];
  /** Inactive (discontinued) SKUs and their IMS history — only used for the volume bridge. */
  inactiveSkus?: DatasetSku[];
  inactiveIms?: ValueRow[];
  /** Latest competitor upload for the country (market context), if any. */
  competitor?: { brandMonthly: Record<string, Record<string, number[]>>; uploadedBy: string | null; uploadedAt: string | null } | null;
  /** "Today" — injected so tests are deterministic. */
  now: Date;
}

// ── Basic utils ──────────────────────────────────────────────────────────────

export const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const num = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const round = (v: number, d = 0): number => {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
};

export const pct = (value: number, reference: number): number | null =>
  reference === 0 ? null : round(((value - reference) / Math.abs(reference)) * 100, 1);

export const ratioPct = (num_: number, den: number): number | null => (den === 0 ? null : round((num_ / den) * 100, 1));

export const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export const isIntlCountry = (c: PerformanceCountry): boolean => c !== "Lebanon";

export function shortLabel(p: { year: number; month: number }): string {
  return `${MONTH_SHORT[p.month]}'${String(p.year).slice(-2)}`;
}

export function toPeriodRef(p: DatasetPeriod): PeriodRef {
  return { id: p.id, year: p.year, month: p.month, label: p.label, short: shortLabel(p) };
}

export function ymKey(p: { year: number; month: number }): string {
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export function parseYm(s: string | undefined | null): { year: number; month: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v);
  // "YYYY-MM-DD" → construct in local time to avoid UTC day shifts
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function isoDate(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Same rule as ShipmentPage.computeArrivalDate: 1st of the production month + offset. */
export function computeExpectedArrival(year: number, month: number, offsetValue: number, offsetUnit: string): Date {
  const base = new Date(year, month - 1, 1);
  if (offsetUnit === "weeks") base.setDate(base.getDate() + offsetValue * 7);
  else if (offsetUnit === "months") base.setMonth(base.getMonth() + offsetValue);
  else base.setDate(base.getDate() + offsetValue);
  return base;
}

export function monthIndexOf(periods: DatasetPeriod[], year: number, month: number): number {
  return periods.findIndex((p) => p.year === year && p.month === month);
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

// ── SKU filtering ────────────────────────────────────────────────────────────

export function flavourOf(sku: { name: string; weight: string }): string {
  return sku.name.replace(/^Al Fakher\s*/i, "").replace(new RegExp(`\\s*${sku.weight}\\s*$`, "i"), "").trim() || sku.name;
}

export function applyFilters(skus: DatasetSku[], filters: PerformanceFilters | undefined): DatasetSku[] {
  if (!filters) return skus;
  const has = (xs?: string[]) => Array.isArray(xs) && xs.length > 0;
  return skus.filter((s) => {
    if (has(filters.weights) && !filters.weights!.includes(s.weight)) return false;
    if (has(filters.categories) && !filters.categories!.includes(s.category ?? "Core")) return false;
    if (has(filters.packaging) && !filters.packaging!.includes(s.packagingType ?? "New")) return false;
    if (has(filters.flavours) && !filters.flavours!.includes(flavourOf(s))) return false;
    return true;
  });
}

export function filterOptions(skus: DatasetSku[]) {
  const uniq = (xs: string[]) => Array.from(new Set(xs));
  const weightGrams = (w: string) => {
    const m = /^([\d.]+)\s*(kg|g)$/i.exec(w.trim());
    if (!m) return Number.MAX_SAFE_INTEGER;
    return m[2].toLowerCase() === "kg" ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
  };
  return {
    weights: uniq(skus.map((s) => s.weight)).sort((a, b) => weightGrams(a) - weightGrams(b)),
    categories: uniq(skus.map((s) => s.category ?? "Core")).sort(),
    packaging: uniq(skus.map((s) => s.packagingType ?? "New")).sort(),
    flavours: uniq(skus.map(flavourOf)).sort((a, b) => a.localeCompare(b)),
  };
}

// ── Monthly series per SKU (Planning FG replica) ─────────────────────────────

export interface MonthCell {
  period: DatasetPeriod;
  forecast: number;
  /** actual_production_data value when > 0, else Production sheet weekly total. */
  actualProduction: number;
  /** Planning FG "Production / Invoiced" row: actual override when present, else forecast. */
  production: number;
  hasActualProduction: boolean;
  ims: number;
  imsSource: string;
  /** Raw IMS entered by a person (not auto-filled) for a month up to today. */
  imsIsActual: boolean;
  effectiveIms: number;
  /** Planned demand for projections: entered IMS when non-zero, else forecast. */
  demand: number;
  arrivals: number;
  /** Planned arrivals for this month (Expected Arrivals rule — planned only). */
  plannedArrivals: number;
  opening: number;
  adjustments: number;
  closing: number;
  weeks: number | null;
  zone: CoverZone;
  isFuture: boolean;
}

export interface SkuSeries {
  sku: DatasetSku;
  months: MonthCell[];
}

export interface Batch {
  sku: DatasetSku;
  period: DatasetPeriod;
  plannedMc: number;
  actualMc: number;
  /** Actual when entered, else plan — the quantity the batch is sized at. */
  producedMc: number;
  clearedMc: number;
  pendingMc: number;
  offsetValue: number;
  offsetUnit: string;
  expectedArrival: Date | null;
  status: string;
  firstClearedDate: Date | null;
  lastClearedDate: Date | null;
  invoiceRef: string | null;
  containerRef: string | null;
  note: string | null;
  eventCount: number;
}

const key = (skuId: number, periodId: number) => `${skuId}-${periodId}`;

export function sortedPeriods(ds: PerformanceDataset): DatasetPeriod[] {
  return [...ds.periods].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function currentYm(now: Date): { year: number; month: number } {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function isStrictlyFuture(p: { year: number; month: number }, now: Date): boolean {
  const c = currentYm(now);
  return p.year > c.year || (p.year === c.year && p.month > c.month);
}

/** Sum of clearance events by (sku, cleared-date month). Mirrors IntlPlanningFgPage.arrivalFromProductionMap. */
export function clearanceByClearedMonth(events: ClearanceRow[], periods: DatasetPeriod[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const ev of events) {
    const qty = num(ev.clearedQty);
    if (!ev.clearedDate || qty <= 0) continue;
    const d = toDate(ev.clearedDate);
    if (!d) continue;
    const idx = monthIndexOf(periods, d.getFullYear(), d.getMonth() + 1);
    if (idx < 0) continue;
    const k = key(ev.skuId, periods[idx].id);
    m.set(k, (m.get(k) ?? 0) + qty);
  }
  return m;
}

export function weeklyTotal(r: WeeklyRow): number {
  return num(r.week1) + num(r.week2) + num(r.week3) + num(r.week4);
}

/** Build the batch list for Syria/Libya/KSA (one per SKU × production month with any production or clearance). */
export function buildBatches(ds: PerformanceDataset, skus: DatasetSku[]): Batch[] {
  const periods = sortedPeriods(ds);
  const skuIds = new Set(skus.map((s) => s.id));
  const forecast = new Map<string, number>();
  for (const r of ds.forecast) forecast.set(key(r.skuId, r.periodId), num(r.value));
  const actual = new Map<string, number>();
  for (const r of ds.actualProduction) {
    const v = num(r.value);
    if (v > 0) actual.set(key(r.skuId, r.periodId), v);
  }
  const ship = new Map<string, ShipmentRow>();
  for (const r of ds.shipment) ship.set(key(r.skuId, r.periodId), r);
  const events = new Map<string, ClearanceRow[]>();
  for (const ev of ds.clearanceEvents) {
    const k = key(ev.skuId, ev.periodId);
    if (!events.has(k)) events.set(k, []);
    events.get(k)!.push(ev);
  }
  const out: Batch[] = [];
  for (const sku of skus) {
    if (!skuIds.has(sku.id)) continue;
    for (const p of periods) {
      const k = key(sku.id, p.id);
      const row = ship.get(k);
      const plannedMc = forecast.get(k) ?? 0;
      const weekly = row ? weeklyTotal(row) : 0;
      const actualMc = actual.get(k) ?? (weekly > 0 ? weekly : 0);
      const evs = events.get(k) ?? [];
      if (plannedMc <= 0 && actualMc <= 0 && evs.length === 0) continue;
      const producedMc = actualMc > 0 ? actualMc : plannedMc;
      const clearedMc = sum(evs.map((e) => num(e.clearedQty)));
      const offsetValue = row?.arrivalOffsetValue ?? 0;
      const offsetUnit = row?.arrivalOffsetUnit ?? "days";
      const dates = evs.map((e) => toDate(e.clearedDate)).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
      const refs = evs.find((e) => e.invoiceRef || e.containerRef);
      out.push({
        sku,
        period: p,
        plannedMc,
        actualMc,
        producedMc,
        clearedMc,
        pendingMc: Math.max(0, producedMc - clearedMc),
        offsetValue,
        offsetUnit,
        expectedArrival: offsetValue > 0 ? computeExpectedArrival(p.year, p.month, offsetValue, offsetUnit) : null,
        status: row?.arrivalStatus ?? "Pending",
        firstClearedDate: dates[0] ?? null,
        lastClearedDate: dates[dates.length - 1] ?? null,
        invoiceRef: refs?.invoiceRef ?? row?.invoiceRef ?? null,
        containerRef: refs?.containerRef ?? row?.containerRef ?? null,
        note: row?.note ?? evs.find((e) => e.notes)?.notes ?? null,
        eventCount: evs.length,
      });
    }
  }
  return out;
}

/**
 * Expected (planned) arrivals per SKU × month.
 *  - Syria/Libya/KSA: each batch's produced MC lands in the month of its
 *    expected arrival date (1st of production month + offset); batches with no
 *    offset are assumed to land in the production month.
 *  - Lebanon: forecast production shifted by the Arrival sheet's offset weeks
 *    for that SKU/month (0 weeks → same month).
 */
export function plannedArrivalsMap(ds: PerformanceDataset, skus: DatasetSku[], batches: Batch[]): Map<string, number> {
  const periods = sortedPeriods(ds);
  const m = new Map<string, number>();
  const add = (skuId: number, year: number, month: number, mc: number) => {
    if (mc <= 0) return;
    const idx = monthIndexOf(periods, year, month);
    if (idx < 0) return;
    const k = key(skuId, periods[idx].id);
    m.set(k, (m.get(k) ?? 0) + mc);
  };
  if (isIntlCountry(ds.country)) {
    for (const b of batches) {
      if (b.producedMc <= 0) continue;
      const d = b.expectedArrival ?? new Date(b.period.year, b.period.month - 1, 1);
      add(b.sku.id, d.getFullYear(), d.getMonth() + 1, b.producedMc);
    }
    return m;
  }
  const offsets = new Map<string, number>();
  for (const r of ds.arrival) offsets.set(key(r.skuId, r.periodId), r.arrivalOffsetWeeks ?? 0);
  const skuIds = new Set(skus.map((s) => s.id));
  for (const r of ds.forecast) {
    if (!skuIds.has(r.skuId)) continue;
    const v = num(r.value);
    if (v <= 0) continue;
    const p = periods.find((x) => x.id === r.periodId);
    if (!p) continue;
    const weeks = offsets.get(key(r.skuId, r.periodId)) ?? 0;
    const shift = Math.round(weeks / 4.33);
    const t = addMonths(p.year, p.month, shift);
    add(r.skuId, t.year, t.month, v);
  }
  return m;
}

/** The Planning FG replica. One entry per active SKU with a full month chain. */
export function buildSkuSeries(ds: PerformanceDataset, skus: DatasetSku[] = ds.skus, plannedArrivals?: Map<string, number>): SkuSeries[] {
  const periods = sortedPeriods(ds);
  const rule = coverRuleFor(ds.country);
  const intl = isIntlCountry(ds.country);
  const forecast = new Map<string, number>();
  for (const r of ds.forecast) forecast.set(key(r.skuId, r.periodId), num(r.value));
  const ims = new Map<string, { value: number; source: string }>();
  for (const r of ds.ims) ims.set(key(r.skuId, r.periodId), { value: num(r.value), source: r.source ?? "manual" });
  const actual = new Map<string, number>();
  for (const r of ds.actualProduction) {
    const v = num(r.value);
    if (v > 0) actual.set(key(r.skuId, r.periodId), v);
  }
  const shipTotals = new Map<string, number>();
  for (const r of ds.shipment) shipTotals.set(key(r.skuId, r.periodId), weeklyTotal(r));
  const planning = new Map<string, PlanningRow>();
  for (const r of ds.planningFg) planning.set(key(r.skuId, r.periodId), r);
  const lebArrivals = new Map<string, number>();
  if (!intl) for (const r of ds.arrival) lebArrivals.set(key(r.skuId, r.periodId), weeklyTotal(r));
  const cleared = intl ? clearanceByClearedMonth(ds.clearanceEvents, periods) : new Map<string, number>();

  const out: SkuSeries[] = [];
  for (const sku of skus) {
    const months: MonthCell[] = [];
    // First pass: raw values.
    for (const p of periods) {
      const k = key(sku.id, p.id);
      const fc = forecast.get(k) ?? 0;
      const imsRow = ims.get(k);
      const rawIms = imsRow?.value ?? 0;
      const source = imsRow?.source ?? "manual";
      const future = isStrictlyFuture(p, ds.now);
      const effectiveIms = rawIms !== 0 ? rawIms : future ? fc : 0;
      const actualProd = actual.get(k) ?? ((shipTotals.get(k) ?? 0) > 0 ? shipTotals.get(k)! : 0);
      const revised = actual.get(k);
      const pg = planning.get(k);
      const planningArr = num(pg?.arrivals);
      const arrivals = intl ? cleared.get(k) ?? 0 : planningArr !== 0 ? planningArr : lebArrivals.get(k) ?? 0;
      months.push({
        period: p,
        forecast: fc,
        actualProduction: actualProd,
        production: revised !== undefined ? revised : fc,
        hasActualProduction: actualProd > 0,
        ims: rawIms,
        imsSource: source,
        imsIsActual: rawIms !== 0 && source !== "auto_forecast" && !future,
        effectiveIms,
        demand: rawIms !== 0 ? rawIms : fc,
        arrivals,
        plannedArrivals: plannedArrivals?.get(k) ?? 0,
        opening: 0,
        adjustments: num(pg?.adjustments),
        closing: 0,
        weeks: null,
        zone: "Out of Stock",
        isFuture: future,
      });
    }
    // Second pass: chain closing stock exactly like Planning FG.
    let prevClosing = 0;
    for (let i = 0; i < months.length; i++) {
      const c = months[i];
      const pg = planning.get(key(sku.id, c.period.id));
      c.opening = i === 0 ? num(pg?.openingStock) : prevClosing;
      const imsUsed = intl ? c.ims : c.effectiveIms;
      c.closing = c.opening + c.adjustments + c.arrivals - imsUsed;
      prevClosing = c.closing;
    }
    // Third pass: weeks of cover with the country's rule.
    const demandForCover = months.map((c) => (intl ? c.ims : c.effectiveIms));
    for (let i = 0; i < months.length; i++) {
      const c = months[i];
      c.weeks = weeksOfCoverAt(c.closing, demandForCover, i, rule);
      c.zone = classifyZone(c.weeks, c.closing);
    }
    out.push({ sku, months });
  }
  return out;
}

// ── Windows ──────────────────────────────────────────────────────────────────

export interface Window {
  fromIdx: number;
  toIdx: number;
  months: DatasetPeriod[];
}

/** Latest period (not after today) with human-entered IMS for any of the SKUs. */
export function latestActualImsIndex(series: SkuSeries[], periods: DatasetPeriod[], now: Date): number {
  let best = -1;
  for (const s of series) {
    for (let i = 0; i < s.months.length; i++) {
      const c = s.months[i];
      if (c.imsIsActual && !isStrictlyFuture(c.period, now)) best = Math.max(best, i);
    }
  }
  if (best >= 0) return best;
  const cur = currentYm(now);
  const curIdx = monthIndexOf(periods, cur.year, cur.month);
  return curIdx >= 0 ? curIdx : periods.length - 1;
}

export function resolveWindow(periods: DatasetPeriod[], preset: PeriodPreset, anchorIdx: number, from?: string, to?: string): Window {
  const clamp = (i: number) => Math.min(periods.length - 1, Math.max(0, i));
  const a = clamp(anchorIdx);
  const anchor = periods[a];
  let fromIdx = a;
  const toIdx = a;
  if (preset === "qtd") {
    const qStartMonth = Math.floor((anchor.month - 1) / 3) * 3 + 1;
    const idx = monthIndexOf(periods, anchor.year, qStartMonth);
    fromIdx = idx >= 0 ? idx : clamp(a - ((anchor.month - qStartMonth) % 3));
  } else if (preset === "ytd") {
    const idx = monthIndexOf(periods, anchor.year, 1);
    fromIdx = idx >= 0 ? idx : periods.findIndex((p) => p.year === anchor.year);
    if (fromIdx < 0) fromIdx = 0;
  } else if (preset === "l12m") {
    fromIdx = clamp(a - 11);
  } else if (preset === "custom") {
    const f = parseYm(from);
    const t = parseYm(to);
    let fi = f ? monthIndexOf(periods, f.year, f.month) : -1;
    let ti = t ? monthIndexOf(periods, t.year, t.month) : -1;
    if (fi < 0) fi = a;
    if (ti < 0) ti = a;
    if (fi > ti) [fi, ti] = [ti, fi];
    return { fromIdx: fi, toIdx: ti, months: periods.slice(fi, ti + 1) };
  }
  return { fromIdx, toIdx, months: periods.slice(fromIdx, toIdx + 1) };
}

/** Same calendar months one year earlier. Null when none of them exist. */
export function lastYearWindow(periods: DatasetPeriod[], w: Window): Window | null {
  const idxs = w.months.map((p) => monthIndexOf(periods, p.year - 1, p.month)).filter((i) => i >= 0);
  if (idxs.length === 0) return null;
  const fromIdx = Math.min(...idxs);
  const toIdx = Math.max(...idxs);
  return { fromIdx, toIdx, months: periods.slice(fromIdx, toIdx + 1) };
}

/** The window of equal length immediately before. Null when it would start before the data. */
export function previousWindow(periods: DatasetPeriod[], w: Window): Window | null {
  const len = w.toIdx - w.fromIdx + 1;
  const toIdx = w.fromIdx - 1;
  const fromIdx = toIdx - len + 1;
  if (fromIdx < 0) return null;
  return { fromIdx, toIdx, months: periods.slice(fromIdx, toIdx + 1) };
}

export function windowLabel(w: Window, preset: PeriodPreset): string {
  const f = w.months[0];
  const t = w.months[w.months.length - 1];
  if (!f || !t) return "";
  if (w.months.length === 1) return f.label;
  const range = `${MONTH_SHORT[f.month]} ${f.year} – ${MONTH_SHORT[t.month]} ${t.year}`;
  if (preset === "ytd") return `Year to date (${range})`;
  if (preset === "qtd") return `Quarter to date (${range})`;
  if (preset === "l12m") return `Last 12 months (${range})`;
  return range;
}

// ── Aggregation over windows ─────────────────────────────────────────────────

export type CellPicker = (c: MonthCell) => number;

export function sumOver(series: SkuSeries[], w: Window | null, pick: CellPicker): number | null {
  if (!w) return null;
  let total = 0;
  for (const s of series) for (let i = w.fromIdx; i <= w.toIdx; i++) total += pick(s.months[i]);
  return total;
}

export function sumAt(series: SkuSeries[], idx: number | null, pick: CellPicker): number | null {
  if (idx === null || idx < 0) return null;
  let total = 0;
  for (const s of series) {
    const c = s.months[idx];
    if (c) total += pick(c);
  }
  return total;
}

export function monthlyTotals(series: SkuSeries[], periods: DatasetPeriod[], pick: CellPicker): number[] {
  return periods.map((_, i) => sum(series.map((s) => pick(s.months[i]))));
}

export function makeDelta(value: number | null, reference: number | null, note?: string): Delta {
  if (value === null || reference === null) return { reference, delta: null, pct: null, note: note ?? "Not available" };
  return { reference: round(reference), delta: round(value - reference), pct: pct(value, reference) };
}

export function sparkline(periods: DatasetPeriod[], toIdx: number, values: (number | null)[]): SparkPoint[] {
  const start = Math.max(0, toIdx - 11);
  const out: SparkPoint[] = [];
  for (let i = start; i <= toIdx; i++) out.push({ label: shortLabel(periods[i]), value: values[i] ?? null });
  return out;
}

/** Aggregate weeks of cover on totals using the country rule. */
export function totalWeeksAt(series: SkuSeries[], idx: number, country: PerformanceCountry): number | null {
  const rule: CoverRule = coverRuleFor(country);
  const intl = isIntlCountry(country);
  const closing = sumAt(series, idx, (c) => c.closing) ?? 0;
  const n = series[0]?.months.length ?? 0;
  const demand: number[] = [];
  for (let i = 0; i < n; i++) demand.push(sumAt(series, i, (c) => (intl ? c.ims : c.effectiveIms)) ?? 0);
  return weeksOfCoverAt(closing, demand, idx, rule);
}

export function targetBandMcAt(series: SkuSeries[], idx: number, country: PerformanceCountry): { low: number; high: number } {
  const rule = coverRuleFor(country);
  const intl = isIntlCountry(country);
  const n = series[0]?.months.length ?? 0;
  const demand: number[] = [];
  for (let i = 0; i < n; i++) demand.push(sumAt(series, i, (c) => (intl ? c.ims : c.effectiveIms)) ?? 0);
  return { low: mcForWeeks(4, demand, idx, rule), high: mcForWeeks(6, demand, idx, rule) };
}

// ── RAG rules ────────────────────────────────────────────────────────────────

export function ragVsPlan(deltaPct: number | null, thresholds: [number, number] = [-5, -15]): { status: Rag; reason: string } {
  if (deltaPct === null) return { status: "grey", reason: "No plan to compare against" };
  if (deltaPct >= thresholds[0]) return { status: "green", reason: `Within ${Math.abs(thresholds[0])}% of plan` };
  if (deltaPct >= thresholds[1]) return { status: "amber", reason: `${Math.abs(thresholds[0])}–${Math.abs(thresholds[1])}% below plan` };
  return { status: "red", reason: `More than ${Math.abs(thresholds[1])}% below plan` };
}

export function ragAttainment(p: number | null): { status: Rag; reason: string } {
  if (p === null) return { status: "grey", reason: "No plan in this period" };
  if (p >= 95) return { status: "green", reason: "At least 95% of plan delivered" };
  if (p >= 85) return { status: "amber", reason: "85–95% of plan delivered" };
  return { status: "red", reason: "Below 85% of plan" };
}

export function ragCover(weeks: number | null, closing: number): { status: Rag; reason: string } {
  if (weeks === null) return closing > 0 ? { status: "amber", reason: "Stock on hand but no sales to measure cover" } : { status: "grey", reason: "No stock and no sales" };
  if (weeks < 0) return { status: "red", reason: "Negative stock — data needs checking" };
  if (weeks >= 4 && weeks <= 6) return { status: "green", reason: "Inside the 4–6 week target" };
  if ((weeks >= 3 && weeks < 4) || (weeks > 6 && weeks <= 8)) return { status: "amber", reason: "Just outside the 4–6 week target" };
  return weeks < 3 ? { status: "red", reason: "Under 3 weeks of cover" } : { status: "red", reason: "Over 8 weeks of cover" };
}

export function ragAccuracy(p: number | null): { status: Rag; reason: string } {
  if (p === null) return { status: "grey", reason: "No months with actual IMS to measure" };
  if (p >= 85) return { status: "green", reason: "Accuracy at or above 85%" };
  if (p >= 70) return { status: "amber", reason: "Accuracy between 70% and 85%" };
  return { status: "red", reason: "Accuracy below 70%" };
}

export function ragCount(count: number, total: number, amberShare = 0.1, redShare = 0.25): { status: Rag; reason: string } {
  if (total === 0) return { status: "grey", reason: "No SKUs in scope" };
  if (count === 0) return { status: "green", reason: "No SKUs affected" };
  const share = count / total;
  if (share < amberShare) return { status: "amber", reason: `${count} of ${total} SKUs affected` };
  if (share < redShare) return { status: "amber", reason: `${count} of ${total} SKUs affected` };
  return { status: "red", reason: `${count} of ${total} SKUs affected (${round(share * 100)}%)` };
}

export function ragWeeksOfDemand(mc: number, monthlyDemand: number, amberWeeks = 2, redWeeks = 4): { status: Rag; reason: string } {
  if (mc <= 0) return { status: "green", reason: "Nothing outstanding" };
  if (monthlyDemand <= 0) return { status: "amber", reason: "Outstanding volume but no sales run-rate to size it" };
  const weeks = (mc / monthlyDemand) * 4.33;
  if (weeks < amberWeeks) return { status: "green", reason: `Under ${amberWeeks} weeks of sales` };
  if (weeks < redWeeks) return { status: "amber", reason: `${amberWeeks}–${redWeeks} weeks of sales outstanding` };
  return { status: "red", reason: `Over ${redWeeks} weeks of sales outstanding` };
}

export function worstRag(statuses: Rag[]): Rag {
  if (statuses.includes("red")) return "red";
  if (statuses.includes("amber")) return "amber";
  if (statuses.includes("green")) return "green";
  return "grey";
}

// ── Demand analytics ─────────────────────────────────────────────────────────

export function runningRate(values: (number | null)[], idx: number, n: number): number | null {
  const slice: number[] = [];
  for (let i = idx; i >= 0 && slice.length < n; i--) {
    const v = values[i];
    if (v !== null && v !== undefined) slice.push(v);
  }
  if (slice.length < n) return null;
  return round(sum(slice) / n, 1);
}

const RAMADAN_MONTHS: Record<number, number[]> = { 2024: [3, 4], 2025: [3], 2026: [2, 3], 2027: [1, 2], 2028: [1, 12] };

export function seasonTag(year: number, month: number): "Ramadan" | "Summer" | null {
  if (RAMADAN_MONTHS[year]?.includes(month)) return "Ramadan";
  if (month >= 6 && month <= 8) return "Summer";
  return null;
}

/** Seasonality index per calendar month = average of that month's actual IMS ÷ overall monthly average. */
export function seasonalityIndex(periods: DatasetPeriod[], actualTotals: (number | null)[]): SeasonalityPoint[] {
  const byMonth = new Map<number, number[]>();
  for (let i = 0; i < periods.length; i++) {
    const v = actualTotals[i];
    if (v === null || v === undefined) continue;
    const m = periods[i].month;
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m)!.push(v);
  }
  const all = Array.from(byMonth.values()).flat();
  const overall = all.length ? sum(all) / all.length : 0;
  const out: SeasonalityPoint[] = [];
  for (let m = 1; m <= 12; m++) {
    const xs = byMonth.get(m) ?? [];
    const avg = xs.length ? sum(xs) / xs.length : null;
    const latestYear = [...periods].reverse().find((p) => p.month === m)?.year;
    out.push({
      month: m,
      label: MONTH_SHORT[m],
      index: avg !== null && overall > 0 ? round(avg / overall, 2) : null,
      yearsUsed: xs.length,
      tag: latestYear ? seasonTag(latestYear, m) : null,
    });
  }
  return out;
}

export function paretoRows(rows: { sku: string; weight: string; mc: number }[]): ParetoRow[] {
  const sorted = [...rows].filter((r) => r.mc > 0).sort((a, b) => b.mc - a.mc);
  const total = sum(sorted.map((r) => r.mc));
  let cum = 0;
  let reached = false;
  return sorted.map((r) => {
    cum += r.mc;
    const cumulativePct = total > 0 ? round((cum / total) * 100, 1) : 0;
    const inTop80 = !reached;
    if (cumulativePct >= 80) reached = true;
    return { sku: r.sku, weight: r.weight, mc: round(r.mc), sharePct: total > 0 ? round((r.mc / total) * 100, 1) : 0, cumulativePct, inTop80 };
  });
}

export function topMovers(rows: { sku: string; weight: string; current: number; reference: number }[], n = 10): { growers: Mover[]; decliners: Mover[] } {
  const movers: Mover[] = rows.map((r) => ({
    sku: r.sku,
    weight: r.weight,
    current: round(r.current),
    reference: round(r.reference),
    deltaMc: round(r.current - r.reference),
    deltaPct: pct(r.current, r.reference),
  }));
  const growers = movers.filter((m) => m.deltaMc > 0).sort((a, b) => b.deltaMc - a.deltaMc).slice(0, n);
  const decliners = movers.filter((m) => m.deltaMc < 0).sort((a, b) => a.deltaMc - b.deltaMc).slice(0, n);
  return { growers, decliners };
}

// ── Forecast accuracy ────────────────────────────────────────────────────────

export interface AccuracySample {
  sku: string;
  weight: string;
  label: string;
  forecast: number;
  actual: number;
}

/** Collect (sku, month) pairs with human-entered IMS inside the window. Auto-filled months are excluded. */
export function accuracySamples(series: SkuSeries[], w: Window): { samples: AccuracySample[]; excludedAutoFilled: number } {
  const samples: AccuracySample[] = [];
  let excludedAutoFilled = 0;
  for (const s of series) {
    for (let i = w.fromIdx; i <= w.toIdx; i++) {
      const c = s.months[i];
      if (c.ims !== 0 && c.imsSource === "auto_forecast") {
        excludedAutoFilled++;
        continue;
      }
      if (!c.imsIsActual) continue;
      samples.push({ sku: s.sku.name, weight: s.sku.weight, label: shortLabel(c.period), forecast: c.forecast, actual: c.ims });
    }
  }
  return { samples, excludedAutoFilled };
}

export function accuracyOf(samples: { forecast: number; actual: number }[]): { accuracyPct: number | null; biasPct: number | null; forecast: number; actual: number } {
  const forecast = sum(samples.map((s) => s.forecast));
  const actual = sum(samples.map((s) => s.actual));
  const absErr = sum(samples.map((s) => Math.abs(s.forecast - s.actual)));
  if (samples.length === 0 || actual <= 0) return { accuracyPct: null, biasPct: null, forecast: round(forecast), actual: round(actual) };
  return {
    accuracyPct: round(Math.max(0, 1 - absErr / actual) * 100, 1),
    biasPct: round(((forecast - actual) / actual) * 100, 1),
    forecast: round(forecast),
    actual: round(actual),
  };
}

export function accuracyByMonth(samples: AccuracySample[], order: string[]): AccuracyPoint[] {
  return order
    .map((label) => {
      const xs = samples.filter((s) => s.label === label);
      const a = accuracyOf(xs);
      return { label, forecast: a.forecast, actual: a.actual, accuracyPct: a.accuracyPct, biasPct: a.biasPct, skusMeasured: xs.length };
    })
    .filter((p) => p.skusMeasured > 0);
}

export function accuracyByGroup(samples: AccuracySample[], groupOf: (s: AccuracySample) => string, weightOf?: (s: AccuracySample) => string): AccuracyGroup[] {
  const groups = new Map<string, AccuracySample[]>();
  for (const s of samples) {
    const g = groupOf(s);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  }
  return Array.from(groups.entries())
    .map(([group, xs]) => {
      const a = accuracyOf(xs);
      return { group, weight: weightOf ? weightOf(xs[0]) : undefined, ...a, monthsMeasured: new Set(xs.map((x) => x.label)).size };
    })
    .sort((a, b) => (a.accuracyPct ?? -1) - (b.accuracyPct ?? -1));
}

/** SKUs whose forecast has been on the same side of actual (by ≥10%) for 3+ consecutive measured months. */
export function chronicBias(series: SkuSeries[], toIdx: number, lookback = 6, minRun = 3): ChronicSku[] {
  const out: ChronicSku[] = [];
  for (const s of series) {
    let run = 0;
    let direction: "over" | "under" | null = null;
    const biases: number[] = [];
    for (let i = toIdx; i >= 0 && toIdx - i < lookback; i--) {
      const c = s.months[i];
      if (!c || !c.imsIsActual || c.ims <= 0) continue;
      const bias = ((c.forecast - c.ims) / c.ims) * 100;
      const dir: "over" | "under" | null = bias >= 10 ? "over" : bias <= -10 ? "under" : null;
      if (dir === null) break;
      if (direction === null) direction = dir;
      if (dir !== direction) break;
      run++;
      biases.push(bias);
    }
    if (direction && run >= minRun) out.push({ sku: s.sku.name, weight: s.sku.weight, direction, consecutiveMonths: run, avgBiasPct: round(sum(biases) / biases.length, 1) });
  }
  return out.sort((a, b) => Math.abs(b.avgBiasPct) - Math.abs(a.avgBiasPct));
}

// ── Inventory analytics ──────────────────────────────────────────────────────

export interface ProjectionRow {
  sku: DatasetSku;
  openingStock: number;
  demand: number[];
  arrivals: number[];
  production: number[];
  labels: string[];
}

/** Projection inputs for the months after `fromIdx` (exclusive) — `horizon` months. */
export function projectionInputs(series: SkuSeries[], periods: DatasetPeriod[], fromIdx: number, horizon: number, intl: boolean): ProjectionRow[] {
  return series.map((s) => {
    const demand: number[] = [];
    const arrivals: number[] = [];
    const production: number[] = [];
    const labels: string[] = [];
    for (let i = fromIdx + 1; i <= fromIdx + horizon && i < periods.length; i++) {
      const c = s.months[i];
      demand.push(c.demand);
      // Intl: Planning FG only counts cleared arrivals; add the planned (expected) ones that are not cleared yet.
      arrivals.push(intl ? Math.max(c.arrivals, c.plannedArrivals) : c.arrivals !== 0 ? c.arrivals : c.plannedArrivals);
      production.push(c.production);
      labels.push(shortLabel(c.period));
    }
    return { sku: s.sku, openingStock: s.months[fromIdx]?.closing ?? 0, demand, arrivals, production, labels };
  });
}

export function stockoutRisk(row: ProjectionRow, monthsAhead = 3): { monthIndex: number; dayOfMonth: number } | null {
  const trimmed = { skuId: row.sku.id, sku: row.sku.name, weight: row.sku.weight, openingStock: row.openingStock, demand: row.demand.slice(0, monthsAhead), arrivals: row.arrivals.slice(0, monthsAhead) };
  return findStockout(trimmed, 1);
}

export function shortfallBeforeNextArrival(row: ProjectionRow): { shortfall: number; nextArrival: { index: number; mc: number } | null } {
  let stock = row.openingStock;
  let minStock = stock;
  let next: { index: number; mc: number } | null = null;
  for (let i = 0; i < row.demand.length; i++) {
    if (row.arrivals[i] > 0 && next === null) next = { index: i, mc: row.arrivals[i] };
    stock = stock + row.arrivals[i] - row.demand[i];
    if (next === null || i < next.index) minStock = Math.min(minStock, stock);
  }
  return { shortfall: Math.max(0, -minStock), nextArrival: next };
}

export function projectedClosings(row: ProjectionRow, country: PerformanceCountry): number[] {
  return projectSku({ skuId: row.sku.id, sku: row.sku.name, weight: row.sku.weight, openingStock: row.openingStock, demand: row.demand, arrivals: row.arrivals }, 1, coverRuleFor(country)).map((m) => m.closing);
}

/** MC that will not sell before it expires, assuming FIFO at the SKU's monthly run-rate. */
export function expiryAtRisk(rows: ExpiryRowLike[], runRateBySku: Map<number, number>): { sku: string; weight: string; productionPeriod: string; expiryDate: string; remainingMc: number; monthsUntilExpiry: number; atRiskMc: number }[] {
  const bySku = new Map<number, ExpiryRowLike[]>();
  for (const r of rows) {
    if (r.totalRemaining <= 0) continue;
    if (!bySku.has(r.skuId)) bySku.set(r.skuId, []);
    bySku.get(r.skuId)!.push(r);
  }
  const out: ReturnType<typeof expiryAtRisk> = [];
  for (const [skuId, batches] of bySku) {
    const rate = runRateBySku.get(skuId) ?? 0;
    const sorted = [...batches].sort((a, b) => a.productionDate.localeCompare(b.productionDate));
    let cumulativeMonths = 0;
    for (const b of sorted) {
      let atRisk: number;
      if (rate <= 0) atRisk = b.totalRemaining;
      else {
        const monthsToSellThis = b.totalRemaining / rate;
        const finish = cumulativeMonths + monthsToSellThis;
        const overrun = finish - Math.max(0, b.monthsUntilExpiry);
        atRisk = Math.max(0, Math.min(b.totalRemaining, overrun * rate));
        cumulativeMonths = finish;
      }
      if (atRisk > 0.5) {
        out.push({ sku: b.skuName, weight: b.weight, productionPeriod: b.productionPeriodLabel, expiryDate: b.expiryDate, remainingMc: round(b.totalRemaining), monthsUntilExpiry: b.monthsUntilExpiry, atRiskMc: round(atRisk) });
      }
    }
  }
  return out.sort((a, b) => b.atRiskMc - a.atRiskMc);
}

// ── Key messages & risks ─────────────────────────────────────────────────────

export interface MessageFacts {
  country: PerformanceCountry;
  windowLabel: string;
  ims: number;
  imsPlan: number | null;
  imsLy: number | null;
  production: number;
  productionPlan: number | null;
  closing: number;
  weeks: number | null;
  criticalSkus: { sku: string; shortfall: number }[];
  overstockSkus: { sku: string; excess: number }[];
  accuracyPct: number | null;
  absForecastError: number;
  pendingClearanceMc: number | null;
  delayedBatches: number;
  expiryRiskMc: number | null;
  monthlyDemand: number;
}

const fmtMc = (v: number) => `${Math.round(Math.abs(v)).toLocaleString("en-US")} MC`;
const fmtPct = (v: number) => `${Math.abs(v).toFixed(1)}%`;

export function buildKeyMessages(f: MessageFacts): KeyMessage[] {
  const msgs: Omit<KeyMessage, "rank">[] = [];
  if (f.imsPlan !== null && f.imsPlan > 0) {
    const d = f.ims - f.imsPlan;
    const p = (d / f.imsPlan) * 100;
    msgs.push({
      tone: p >= -5 ? "positive" : p >= -15 ? "warning" : "negative",
      headline: d >= 0 ? `Sell-out is ${fmtPct(p)} ahead of plan` : `Sell-out is ${fmtPct(p)} behind plan`,
      detail: `${fmtMc(f.ims)} sold versus ${fmtMc(f.imsPlan)} planned for ${f.windowLabel} (${d >= 0 ? "+" : "−"}${fmtMc(d)}).`,
      impactMc: Math.abs(d),
    });
  } else {
    msgs.push({ tone: "neutral", headline: "No sell-out plan for this period", detail: `Sell-out was ${fmtMc(f.ims)}; enter forecast values to measure plan attainment.`, impactMc: 0 });
  }
  if (f.imsLy !== null && f.imsLy > 0) {
    const d = f.ims - f.imsLy;
    const p = (d / f.imsLy) * 100;
    msgs.push({
      tone: d >= 0 ? "positive" : p >= -10 ? "warning" : "negative",
      headline: d >= 0 ? `Sell-out grew ${fmtPct(p)} versus last year` : `Sell-out fell ${fmtPct(p)} versus last year`,
      detail: `${fmtMc(f.ims)} this period against ${fmtMc(f.imsLy)} in the same months last year.`,
      impactMc: Math.abs(d),
    });
  } else {
    msgs.push({ tone: "neutral", headline: "No prior-year sell-out to compare", detail: "Year-on-year growth will appear once the same months of last year hold IMS data.", impactMc: 0 });
  }
  if (f.productionPlan !== null && f.productionPlan > 0) {
    const d = f.production - f.productionPlan;
    const p = (f.production / f.productionPlan) * 100;
    msgs.push({
      tone: p >= 95 ? "positive" : p >= 85 ? "warning" : "negative",
      headline: `Production delivered ${fmtPct(p)} of plan`,
      detail: `${fmtMc(f.production)} produced against ${fmtMc(f.productionPlan)} planned (${d >= 0 ? "+" : "−"}${fmtMc(d)}).`,
      impactMc: Math.abs(d),
    });
  }
  if (f.weeks !== null) {
    const inBand = f.weeks >= 4 && f.weeks <= 6;
    msgs.push({
      tone: inBand ? "positive" : f.weeks < 4 ? "negative" : "warning",
      headline: inBand ? `Stock cover is healthy at ${f.weeks.toFixed(1)} weeks` : f.weeks < 4 ? `Stock cover is thin at ${f.weeks.toFixed(1)} weeks` : `Stock cover is high at ${f.weeks.toFixed(1)} weeks`,
      detail: `Closing stock of ${fmtMc(f.closing)} against a 4–6 week target.`,
      impactMc: f.monthlyDemand > 0 ? Math.abs(f.closing - (f.monthlyDemand * 5) / 4.33) : 0,
    });
  } else if (f.closing > 0) {
    msgs.push({ tone: "warning", headline: "Stock on hand but no sales to measure cover", detail: `Closing stock is ${fmtMc(f.closing)} with no IMS in the reference month.`, impactMc: f.closing });
  }
  if (f.criticalSkus.length > 0) {
    const shortfall = sum(f.criticalSkus.map((s) => s.shortfall));
    const names = f.criticalSkus.slice(0, 3).map((s) => s.sku).join(", ");
    msgs.push({
      tone: "negative",
      headline: `${f.criticalSkus.length} SKU${f.criticalSkus.length > 1 ? "s" : ""} at risk of stock-out in the next 3 months`,
      detail: `${names}${f.criticalSkus.length > 3 ? ` and ${f.criticalSkus.length - 3} more` : ""}. Projected shortfall ${fmtMc(shortfall)} before the next arrival.`,
      impactMc: shortfall > 0 ? shortfall : f.monthlyDemand,
    });
  }
  if (f.overstockSkus.length > 0) {
    const excess = sum(f.overstockSkus.map((s) => s.excess));
    msgs.push({
      tone: "warning",
      headline: `${f.overstockSkus.length} SKU${f.overstockSkus.length > 1 ? "s" : ""} carrying more than 6 weeks of stock`,
      detail: `${fmtMc(excess)} above the 6-week ceiling; top item ${f.overstockSkus[0].sku}.`,
      impactMc: excess,
    });
  }
  if (f.pendingClearanceMc !== null && f.pendingClearanceMc > 0) {
    msgs.push({
      tone: f.delayedBatches > 0 ? "negative" : "warning",
      headline: `${fmtMc(f.pendingClearanceMc)} produced but not yet cleared`,
      detail: f.delayedBatches > 0 ? `${f.delayedBatches} batch${f.delayedBatches > 1 ? "es are" : " is"} past the expected arrival date by more than a week.` : "All batches are within their expected transit time.",
      impactMc: f.pendingClearanceMc,
    });
  }
  if (f.accuracyPct !== null) {
    msgs.push({
      tone: f.accuracyPct >= 85 ? "positive" : f.accuracyPct >= 70 ? "warning" : "negative",
      headline: `Forecast accuracy is ${f.accuracyPct.toFixed(0)}%`,
      detail: `Absolute forecast error of ${fmtMc(f.absForecastError)} across the months with actual IMS.`,
      impactMc: f.absForecastError,
    });
  }
  if (f.expiryRiskMc !== null && f.expiryRiskMc > 0) {
    msgs.push({ tone: "negative", headline: `${fmtMc(f.expiryRiskMc)} may expire before it sells`, detail: "Based on first-in-first-out sell-through at the current run-rate.", impactMc: f.expiryRiskMc });
  }
  const ranked = msgs.sort((a, b) => b.impactMc - a.impactMc);
  const picked = ranked.slice(0, 6);
  return picked.map((m, i) => ({ rank: i + 1, ...m, impactMc: round(m.impactMc) }));
}

export interface RiskFacts {
  atRisk: { sku: string; weight: string; shortfall: number; stockoutDate: string | null; nextArrival: { month: string; mc: number } | null }[];
  overstock: { sku: string; weight: string; excess: number; monthsToSell: number | null }[];
  delayed: { sku: string; weight: string; pendingMc: number; daysLate: number | null; invoiceRef: string | null; productionPeriod: string }[];
  chronic: { sku: string; weight: string; direction: "over" | "under"; avgBiasPct: number; monthlyDemand: number }[];
  expiry: { sku: string; weight: string; atRiskMc: number; expiryDate: string }[];
}

export function buildRisks(f: RiskFacts, limit = 5): RiskItem[] {
  const items: Omit<RiskItem, "rank">[] = [];
  for (const r of f.atRisk) {
    items.push({
      sku: r.sku,
      weight: r.weight,
      issue: r.stockoutDate ? `Projected stock-out around ${r.stockoutDate}` : "Stock cover below 4 weeks",
      impactMc: round(r.shortfall),
      action: r.nextArrival ? `Pull forward the ${r.nextArrival.month} arrival (${fmtMc(r.nextArrival.mc)}) or add ${fmtMc(r.shortfall)} to the next production run` : `Schedule production of at least ${fmtMc(r.shortfall)} — no arrival is planned`,
      severity: "red",
    });
  }
  for (const r of f.overstock) {
    items.push({
      sku: r.sku,
      weight: r.weight,
      issue: r.monthsToSell !== null ? `Overstock — ${r.monthsToSell.toFixed(1)} months to sell through` : "Overstock with no recent sales",
      impactMc: round(r.excess),
      action: `Cut or push out the next production by ${fmtMc(r.excess)}; consider a trade offer to lift sell-out`,
      severity: "amber",
    });
  }
  for (const r of f.delayed) {
    items.push({
      sku: r.sku,
      weight: r.weight,
      issue: `Batch ${r.productionPeriod} not cleared${r.daysLate !== null ? `, ${r.daysLate} days past expected arrival` : ""}`,
      impactMc: round(r.pendingMc),
      action: `Chase customs clearance${r.invoiceRef ? ` (invoice ${r.invoiceRef})` : ""} and confirm the new clearance date`,
      severity: r.daysLate !== null && r.daysLate > 30 ? "red" : "amber",
    });
  }
  for (const r of f.chronic) {
    items.push({
      sku: r.sku,
      weight: r.weight,
      issue: `Forecast consistently ${r.direction === "over" ? "above" : "below"} actual sales (${Math.abs(r.avgBiasPct).toFixed(0)}% on average)`,
      impactMc: round((Math.abs(r.avgBiasPct) / 100) * r.monthlyDemand),
      action: r.direction === "over" ? "Lower the forecast to the running rate to avoid building stock" : "Raise the forecast to the running rate to avoid stock-outs",
      severity: "amber",
    });
  }
  for (const r of f.expiry) {
    items.push({ sku: r.sku, weight: r.weight, issue: `${fmtMc(r.atRiskMc)} may expire (${r.expiryDate})`, impactMc: round(r.atRiskMc), action: "Prioritise this batch in sell-out and consider a promotion", severity: "red" });
  }
  return items
    .sort((a, b) => (a.severity === b.severity ? b.impactMc - a.impactMc : a.severity === "red" ? -1 : 1))
    .slice(0, limit)
    .map((it, i) => ({ rank: i + 1, ...it }));
}

// ── Comparison helper ────────────────────────────────────────────────────────

export function referenceFor(compare: CompareMode, plan: number | null, ly: number | null, prev: number | null): number | null {
  if (compare === "plan") return plan;
  if (compare === "ly") return ly;
  return prev;
}

export function compareLabel(compare: CompareMode): string {
  return compare === "plan" ? "vs plan" : compare === "ly" ? "vs last year" : "vs previous period";
}

// ── Data confidence ──────────────────────────────────────────────────────────

export function confidenceScore(input: { missingImsMonths: number; skusWithoutForecast: number; autoFilledPastMonths: number; skusMissingPrice: number; totalSkus: number; reconciliationOk: boolean }): { score: number; grade: "High" | "Medium" | "Low" } {
  let score = 100;
  score -= Math.min(30, input.missingImsMonths * 2);
  score -= Math.min(20, input.skusWithoutForecast * 3);
  score -= Math.min(10, input.autoFilledPastMonths * 2);
  score -= input.totalSkus > 0 ? Math.min(10, Math.round((input.skusMissingPrice / input.totalSkus) * 10)) : 0;
  if (!input.reconciliationOk) score -= 30;
  score = Math.max(0, Math.round(score));
  return { score, grade: score >= 85 ? "High" : score >= 60 ? "Medium" : "Low" };
}
