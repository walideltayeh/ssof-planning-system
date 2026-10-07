import { mcPrecision, supportsFoc, type FocCell } from "./foc";

type Q = string | number | null | undefined;
export interface FocReceiptDataset {
  country: string;
  skus: { id: number; name?: string; weight?: string; isActive?: boolean; isExcludedFromTotal?: boolean | null; country?: string }[];
  periods: { id: number; year: number; month: number; label?: string; country?: string }[];
  foc?: FocCell[];
  arrival?: { skuId: number; periodId: number; week1?: Q; week2?: Q; week3?: Q; week4?: Q }[];
  planningFg?: { skuId: number; periodId: number; arrivals?: Q }[];
  clearanceEvents?: { skuId: number; clearedQty: Q; clearedDate?: string | Date | null; country?: string }[];
}
export type FocReceiptEntry = {
  skuId: number; periodId: number; sku: string; planMonth: string; receiptPeriodId: number | null; receiptMonth: string;
  quantity: number; received: boolean; receivedDate: string | null; decision: string;
  matches: { source: string; quantity: number; date: string }[]; reviewKey: string; needsReview: boolean;
  added: number; receivedQuantity: number; awaiting: number; excluded: number;
};
export type ReceiptFigures = { label: string; planned: number; received: number; receivedForPlan: number; awaiting: number;
  excluded: number; reviewPending: number; receivedPercent: number | null; missing: number };
export type FocReceiptSummary = {
  entries: FocReceiptEntry[]; warnings: FocReceiptEntry[];
  months: (ReceiptFigures & { periodId: number })[];
  skus: (ReceiptFigures & { skuId: number })[];
  total: ReceiptFigures;
};
export const receiptMonthKey = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, "0")}`;
export const validReceiptDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
const n = (v: Q) => Number(v) || 0;
const near = (a: number, b: number) => a > 0 && Math.abs(a - b) <= Math.max(0.01, b * 0.02) + 1e-8;

/** Re-evaluated from live arrivals on every read. Stable across tracker delete/recreate:
 * evidence keys use dates and quantities, not clearance event IDs.
 * A pending/stale duplicate decision always withholds the additive receipt.
 */
export function evaluateFocReceipts(ds: FocReceiptDataset, includeFoc = true): FocReceiptEntry[] {
  if (!supportsFoc(ds.country)) return [];
  const skus = new Map(ds.skus.filter(s => s.isActive !== false && (!s.country || s.country === ds.country)).map(s => [s.id, s]));
  const periods = new Map(ds.periods.filter(p => !p.country || p.country === ds.country).map(p => [p.id, p]));
  const byMonth = new Map([...periods.values()].map(p => [receiptMonthKey(p), p]));
  const cells = (ds.foc ?? []).filter(c => c.value !== null && Number.isFinite(Number(c.value)) &&
    n(c.value) >= 0 && skus.has(c.skuId) && periods.has(c.periodId) && (!c.country || c.country === ds.country));
  return cells.map(c => {
    const s = skus.get(c.skuId)!, origin = periods.get(c.periodId)!;
    const date = c.receivedDate || null;
    const target = date ? (validReceiptDate(date) ? byMonth.get(date.slice(0, 7)) : undefined) : origin;
    const quantity = mcPrecision(n(c.value));
    const evidence: FocReceiptEntry["matches"] = [];
    if (target) {
      for (const e of ds.clearanceEvents ?? []) {
        if (e.skuId !== c.skuId || (e.country && e.country !== ds.country)) continue;
        const d = e.clearedDate instanceof Date ? e.clearedDate.toISOString().slice(0, 10) : e.clearedDate;
        if (d?.slice(0, 7) === receiptMonthKey(target) && n(e.clearedQty) > 0)
          evidence.push({ source: ds.country === "Syria" ? "Tracker / clearance arrival" : "Clearance arrival", date: d, quantity: mcPrecision(n(e.clearedQty)) });
      }
      for (const e of ds.arrival ?? []) if (e.skuId === c.skuId && e.periodId === target.id) {
        const q = mcPrecision(n(e.week1) + n(e.week2) + n(e.week3) + n(e.week4));
        if (q > 0) evidence.push({ source: "Recorded arrival", date: receiptMonthKey(target), quantity: q });
        for (const [i, v] of [e.week1, e.week2, e.week3, e.week4].entries())
          if (n(v) > 0 && n(v) !== q) evidence.push({ source: `Recorded arrival week ${i + 1}`, date: receiptMonthKey(target), quantity: mcPrecision(n(v)) });
      }
      for (const e of ds.planningFg ?? []) if (e.skuId === c.skuId && e.periodId === target.id && n(e.arrivals) > 0)
        evidence.push({ source: "Recorded Planning FG arrival", date: receiptMonthKey(target), quantity: mcPrecision(n(e.arrivals)) });
      // Multiple partial clearances can collectively be the same shipment.
      const clearances = evidence.filter(e => e.source.includes("clearance") || e.source === "Clearance arrival");
      if (clearances.length > 1) evidence.push({ source: "Monthly clearance total", date: receiptMonthKey(target),
        quantity: mcPrecision(clearances.reduce((sum, e) => sum + e.quantity, 0)) });
      for (const other of cells) {
        if (other === c || other.skuId !== c.skuId || !other.received || n(other.value) <= 0) continue;
        const op = periods.get(other.periodId)!;
        const month = other.receivedDate?.slice(0, 7) ?? receiptMonthKey(op);
        if (month === receiptMonthKey(target)) evidence.push({ source: `Other received FOC (${op.label ?? receiptMonthKey(op)})`, date: month, quantity: mcPrecision(n(other.value)) });
      }
    }
    const matches = evidence.filter(e => near(e.quantity, quantity)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const reviewKey = JSON.stringify({ skuId: c.skuId, periodId: c.periodId, quantity, target: target?.id ?? null, date,
      evidence: evidence.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), matches });
    const reviewed = c.receiptReviewKey === reviewKey && ["separate", "included"].includes(c.receiptDecision ?? "");
    const staleReview = !!c.receiptReviewKey && c.receiptReviewKey !== reviewKey;
    const needsReview = !!c.received && (!target || (matches.length > 0 && !reviewed) || staleReview);
    const eligible = !!c.received && !needsReview;
    const included = reviewed && c.receiptDecision === "included";
    return {
      skuId: c.skuId, periodId: c.periodId, sku: `${s.name ?? s.id} ${s.weight ?? ""}`.trim(),
      planMonth: origin.label ?? receiptMonthKey(origin), receiptPeriodId: target?.id ?? null,
      receiptMonth: target?.label ?? date?.slice(0, 7) ?? "Missing planning month", quantity,
      received: c.received ?? false, receivedDate: date, decision: c.receiptDecision ?? "pending",
      matches: staleReview ? evidence : matches, reviewKey, needsReview,
      added: includeFoc && eligible && !included ? quantity : 0,
      receivedQuantity: includeFoc && eligible ? quantity : 0,
      awaiting: !eligible ? quantity : 0, excluded: !includeFoc && eligible ? quantity : 0,
    };
  });
}

/** Calendar receipt totals use the landing month. Receipt percentage is progress
 * against the original plan cohort, so a moved receipt never creates >100%.
 */
export function summarizeFocReceipts(ds: FocReceiptDataset, includeFoc = true,
  skuIds = ds.skus.map(s => s.id), periodIds = ds.periods.map(p => p.id)): FocReceiptSummary {
  const entries = evaluateFocReceipts(ds, includeFoc).filter(e => skuIds.includes(e.skuId));
  const totalSkuIds = skuIds.filter(id => ds.skus.some(s => s.id === id && s.isActive !== false && !s.isExcludedFromTotal && (!s.country || s.country === ds.country)));
  const row = (label: string, ss: number[], ps: number[]): ReceiptFigures => {
    const planned = entries.filter(e => ss.includes(e.skuId) && ps.includes(e.periodId));
    const landed = entries.filter(e => ss.includes(e.skuId) && e.receiptPeriodId !== null && ps.includes(e.receiptPeriodId));
    const sum = (xs: FocReceiptEntry[], f: (e: FocReceiptEntry) => number) => mcPrecision(xs.reduce((a, e) => a + f(e), 0));
    const q = sum(planned, e => e.quantity), progress = sum(planned, e => e.receivedQuantity),
      excluded = sum(planned, e => e.excluded);
    const expected = ds.skus.filter(s => ss.includes(s.id) && s.isActive !== false && (!s.country || s.country === ds.country)).length *
      ds.periods.filter(p => ps.includes(p.id) && (!p.country || p.country === ds.country)).length;
    const missing = Math.max(0, expected - new Set(planned.map(e => `${e.skuId}-${e.periodId}`)).size);
    return { label, planned: q, received: sum(landed, e => e.receivedQuantity), receivedForPlan: progress,
      awaiting: sum(planned, e => e.awaiting), excluded,
      reviewPending: sum(planned, e => e.needsReview ? e.quantity : 0), receivedPercent: !missing && q > 0 ? mcPrecision((progress + excluded) / q * 100) : null, missing };
  };
  return { entries, warnings: entries.filter(e => e.received && (e.needsReview || e.matches.length > 0)),
    months: ds.periods.filter(p => periodIds.includes(p.id)).map(p => ({ periodId: p.id, ...row(p.label ?? receiptMonthKey(p), totalSkuIds, [p.id]) })),
    skus: ds.skus.filter(s => skuIds.includes(s.id)).map(s => ({ skuId: s.id, ...row(`${s.name ?? s.id} ${s.weight ?? ""}`.trim(), [s.id], periodIds) })),
    total: row("Total", totalSkuIds, periodIds) };
}

export function focReceiptAdditions(ds: FocReceiptDataset, includeFoc = true): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of evaluateFocReceipts(ds, includeFoc)) if (r.receiptPeriodId !== null && r.added) {
    const k = `${r.skuId}-${r.receiptPeriodId}`;
    map.set(k, mcPrecision((map.get(k) ?? 0) + r.added));
  }
  return map;
}
