/**
 * The single Planning FG stock ledger, in mastercases.
 * No persistence or tracker-derived balances: planner inputs remain untouched.
 * Clearance dates are business dates, not timezone-dependent instants.
 */
type Quantity = string | number | null | undefined;
type Cell = { skuId: number; periodId: number };
export interface StockDataset {
  country: "Lebanon" | "Syria" | "Libya" | "KSA";
  now: Date;
  skus: { id: number; isActive?: boolean; isExcludedFromTotal?: boolean | null; country?: string }[];
  periods: { id: number; year: number; month: number; sortOrder: number; country?: string }[];
  planningFg: (Cell & { openingStock?: Quantity; adjustments?: Quantity; arrivals?: Quantity })[];
  ims: (Cell & { value: Quantity })[];
  forecast: (Cell & { value: Quantity })[];
  arrival: (Cell & { week1?: Quantity; week2?: Quantity; week3?: Quantity; week4?: Quantity })[];
  clearanceEvents: { skuId: number; clearedQty: Quantity; clearedDate?: string | Date | null; country?: string }[];
}
export interface StockBalance {
  opening: number;
  adjustments: number;
  arrivals: number;
  ims: number;
  closing: number;
}
const num = (v: Quantity) => Number(v) || 0;
export const stockPrecision = (v: number) => Math.round(v * 100) / 100;
const key = (sku: number, period: number) => `${sku}-${period}`;

export function buildStockLedger(ds: StockDataset) {
  const periods = ds.periods.filter(p => !p.country || p.country === ds.country).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const skus = ds.skus.filter(s => s.isActive !== false && (!s.country || s.country === ds.country));
  const planning = new Map(ds.planningFg.map(r => [key(r.skuId, r.periodId), r]));
  const ims = new Map(ds.ims.map(r => [key(r.skuId, r.periodId), num(r.value)]));
  const forecast = new Map(ds.forecast.map(r => [key(r.skuId, r.periodId), num(r.value)]));
  const received = new Map<string, number>();
  if (ds.country === "Lebanon") {
    for (const r of ds.arrival) received.set(key(r.skuId, r.periodId), num(r.week1) + num(r.week2) + num(r.week3) + num(r.week4));
  } else {
    const periodByMonth = new Map(periods.map(p => [`${p.year}-${String(p.month).padStart(2, "0")}`, p.id]));
    for (const ev of ds.clearanceEvents) {
      if (ev.country && ev.country !== ds.country) continue;
      const date = ev.clearedDate instanceof Date ? ev.clearedDate.toISOString() : ev.clearedDate;
      const periodId = date ? periodByMonth.get(date.slice(0, 7)) : undefined;
      if (periodId === undefined || num(ev.clearedQty) <= 0) continue;
      const k = key(ev.skuId, periodId);
      received.set(k, (received.get(k) ?? 0) + num(ev.clearedQty));
    }
  }
  const bySku = new Map<number, Map<number, StockBalance>>();
  const totals = new Map(periods.map(p => [p.id, 0]));
  for (const sku of skus) {
    const balances = new Map<number, StockBalance>();
    let previous = 0;
    periods.forEach((p, i) => {
      const k = key(sku.id, p.id), plan = planning.get(k);
      const future = p.year > ds.now.getFullYear() || (p.year === ds.now.getFullYear() && p.month > ds.now.getMonth() + 1);
      const rawIms = ims.get(k) ?? 0;
      const usedIms = ds.country === "Lebanon" && future && rawIms === 0 ? forecast.get(k) ?? 0 : rawIms;
      const arrivals = ds.country === "Lebanon" && num(plan?.arrivals) !== 0 ? num(plan?.arrivals) : received.get(k) ?? 0;
      const opening = i === 0 ? num(plan?.openingStock) : previous;
      const adjustments = num(plan?.adjustments);
      const closing = stockPrecision(opening + adjustments + arrivals - usedIms);
      balances.set(p.id, { opening, adjustments, arrivals, ims: usedIms, closing });
      if (!sku.isExcludedFromTotal) totals.set(p.id, stockPrecision((totals.get(p.id) ?? 0) + closing));
      previous = closing;
    });
    bySku.set(sku.id, balances);
  }
  return { bySku, totals };
}
