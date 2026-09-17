/**
 * Stock projection + weeks-of-cover helpers shared by the server aggregator
 * (Country Performance pack) and the client (demand scenario slider).
 *
 * The cover formula mirrors each country's Planning FG page exactly:
 *   - Syria / Libya / KSA ("sameMonth"):  weeks = closing ÷ same-month IMS × 4
 *   - Lebanon ("nextTwoAvg"):             weeks = closing ÷ avg(next 2 months IMS) × 4.3
 * Nothing here changes planning data or the Planning FG formulas — it only
 * re-applies them to projected months.
 */

export type CoverMode = "sameMonth" | "nextTwoAvg";
export type CoverZone = "Out of Stock" | "Negative" | "Critical" | "Healthy" | "Overstock";

export interface CoverRule {
  mode: CoverMode;
  factor: number;
}

export interface TargetBand {
  low: number;
  high: number;
}

export interface ProjectionSkuLike {
  skuId: number;
  sku: string;
  weight: string;
  openingStock: number;
  demand: number[];
  arrivals: number[];
  production?: number[];
}

export interface ProjectedMonth {
  demand: number;
  arrivals: number;
  closing: number;
  weeks: number | null;
  targetLowMc: number;
  targetHighMc: number;
}

export const DEFAULT_TARGET_BAND: TargetBand = { low: 4, high: 6 };

export function coverRuleFor(country: string): CoverRule {
  return country === "Lebanon" ? { mode: "nextTwoAvg", factor: 4.3 } : { mode: "sameMonth", factor: 4 };
}

/**
 * Weeks of cover for one month. `demands[i]` is the demand of month i; the
 * Lebanon rule looks at months i+1 and i+2 (missing months count as 0).
 * Returns null when the formula is undefined (no demand but stock on hand, i.e.
 * the Planning FG page shows "∞" / "-∞").
 */
export function weeksOfCoverAt(closing: number, demands: number[], i: number, rule: CoverRule): number | null {
  if (rule.mode === "sameMonth") {
    const ims = demands[i] ?? 0;
    if (ims > 0) return (closing / ims) * rule.factor;
    return closing > 0 ? null : 0;
  }
  if (closing === 0) return 0;
  const n1 = demands[i + 1] ?? 0;
  const n2 = demands[i + 2] ?? 0;
  const avg = n1 !== 0 || n2 !== 0 ? (n1 + n2) / 2 : 0;
  if (avg !== 0) return (closing / avg) * rule.factor;
  return null;
}

/** Demand reference the cover formula divides by, used to express target weeks in MC. */
export function coverDemandReferenceAt(demands: number[], i: number, rule: CoverRule): number {
  if (rule.mode === "sameMonth") return Math.max(0, demands[i] ?? 0);
  const n1 = demands[i + 1] ?? 0;
  const n2 = demands[i + 2] ?? 0;
  return n1 !== 0 || n2 !== 0 ? (n1 + n2) / 2 : 0;
}

/** MC needed to sit at `weeks` of cover in month i. */
export function mcForWeeks(weeks: number, demands: number[], i: number, rule: CoverRule): number {
  const ref = coverDemandReferenceAt(demands, i, rule);
  return (ref * weeks) / rule.factor;
}

export function classifyZone(weeks: number | null, closing: number): CoverZone {
  if (weeks === null) {
    if (closing > 0) return "Overstock";
    if (closing < 0) return "Negative";
    return "Out of Stock";
  }
  if (closing < 0 || weeks < 0) return "Negative";
  if (weeks === 0) return "Out of Stock";
  if (weeks < 4) return "Critical";
  if (weeks <= 6) return "Healthy";
  return "Overstock";
}

export function zoneStatus(zone: CoverZone): "green" | "amber" | "red" | "grey" {
  if (zone === "Healthy") return "green";
  if (zone === "Overstock") return "amber";
  if (zone === "Out of Stock" || zone === "Negative" || zone === "Critical") return "red";
  return "grey";
}

/**
 * Roll one SKU forward: closing[i] = opening(i) + arrivals[i] − demand[i] × multiplier.
 * Arrivals are treated as available within the month they land (monthly model,
 * same as Planning FG).
 */
export function projectSku(input: ProjectionSkuLike, multiplier: number, rule: CoverRule, target: TargetBand = DEFAULT_TARGET_BAND): ProjectedMonth[] {
  const n = Math.max(input.demand.length, input.arrivals.length);
  const scaled = Array.from({ length: n }, (_, i) => (input.demand[i] ?? 0) * multiplier);
  const out: ProjectedMonth[] = [];
  let stock = input.openingStock;
  for (let i = 0; i < n; i++) {
    const arrivals = input.arrivals[i] ?? 0;
    stock = stock + arrivals - scaled[i];
    out.push({
      demand: scaled[i],
      arrivals,
      closing: stock,
      weeks: weeksOfCoverAt(stock, scaled, i, rule),
      targetLowMc: mcForWeeks(target.low, scaled, i, rule),
      targetHighMc: mcForWeeks(target.high, scaled, i, rule),
    });
  }
  return out;
}

/** Sum SKU projections month by month; weeks are recomputed on the totals. */
export function aggregateProjection(inputs: ProjectionSkuLike[], multiplier: number, rule: CoverRule, target: TargetBand = DEFAULT_TARGET_BAND): ProjectedMonth[] {
  const n = inputs.reduce((m, s) => Math.max(m, s.demand.length, s.arrivals.length), 0);
  const demand = new Array(n).fill(0);
  const arrivals = new Array(n).fill(0);
  const closing = new Array(n).fill(0);
  for (const s of inputs) {
    const p = projectSku(s, multiplier, rule, target);
    for (let i = 0; i < n; i++) {
      demand[i] += p[i]?.demand ?? 0;
      arrivals[i] += p[i]?.arrivals ?? 0;
      closing[i] += p[i]?.closing ?? (p.length ? p[p.length - 1].closing : s.openingStock);
    }
  }
  return Array.from({ length: n }, (_, i) => ({
    demand: demand[i],
    arrivals: arrivals[i],
    closing: closing[i],
    weeks: weeksOfCoverAt(closing[i], demand, i, rule),
    targetLowMc: mcForWeeks(target.low, demand, i, rule),
    targetHighMc: mcForWeeks(target.high, demand, i, rule),
  }));
}

/**
 * First month index where projected stock goes negative, plus an interpolated
 * day-of-month assuming demand is spread evenly and arrivals land on day 1.
 */
export function findStockout(input: ProjectionSkuLike, multiplier: number): { monthIndex: number; dayOfMonth: number } | null {
  let stock = input.openingStock;
  const n = Math.max(input.demand.length, input.arrivals.length);
  for (let i = 0; i < n; i++) {
    const available = stock + (input.arrivals[i] ?? 0);
    const demand = (input.demand[i] ?? 0) * multiplier;
    if (available <= 0 && demand > 0) return { monthIndex: i, dayOfMonth: 1 };
    if (demand > available && demand > 0) {
      const fraction = Math.max(0, available) / demand;
      return { monthIndex: i, dayOfMonth: Math.min(30, Math.max(1, Math.round(fraction * 30))) };
    }
    stock = available - demand;
  }
  return null;
}
