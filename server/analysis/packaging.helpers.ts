import type { Packaging, PackagingAnalysis, PackagingFigure, PackagingMetric, PackagingStock } from "../../shared/performance/packaging";
import { analysisSkuLabel, flavourOf, isIntlCountry, monthIndexOf, num, packagingOf, round, sortedPeriods, sum, type PerformanceDataset, type SkuSeries, type Window } from "./countryPerformance.helpers";
import { tabRunningRate } from "./countryPerformance.extra";

const ratio = (value: number, total: number) => total > 0 ? round(value / total * 100, 1) : null;
const change = (value: number, prior: number | null) => prior === null || prior === 0 ? null : round((value - prior) / Math.abs(prior) * 100, 1);

/** End-of-month stock, no replenishment. Zero demand never receives a fictitious clear-out date. */
export function clearOutProjection(stock: number, monthlyRate: number, year: number, month: number) {
  if (stock <= 0) return { monthsToClear: 0, projectedClearMonth: `${year}-${String(month).padStart(2, "0")}` };
  if (monthlyRate <= 0) return { monthsToClear: null, projectedClearMonth: null };
  const months = stock / monthlyRate;
  const date = new Date(Date.UTC(year, month - 1 + Math.ceil(months), 1));
  return { monthsToClear: round(months, 2), projectedClearMonth: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}` };
}

export function buildPackagingAnalysis(ds: PerformanceDataset, w: Window, selected: SkuSeries[]): PackagingAnalysis {
  const periods = sortedPeriods(ds), end = periods[w.toIdx], weeksPerMonth = isIntlCountry(ds.country) ? 4 : 4.3;
  const active = ds.skus.filter(s => s.isActive !== false && !s.isExcludedFromTotal);
  const enabled = new Set(active.map(packagingOf)).size > 1;
  const actual = new Map(ds.ims.filter(r => r.source !== "auto_forecast").map(r => [`${r.skuId}:${r.periodId}`, num(r.value)]));
  const observed = (s: SkuSeries, i: number) => {
    const p = periods[i];
    return p && p.year * 12 + p.month <= ds.now.getFullYear() * 12 + ds.now.getMonth() + 1
      ? actual.get(`${s.sku.id}:${p.id}`) ?? null : null;
  };
  const rate = (s: SkuSeries, i: number) => i < 0 ? 0 : tabRunningRate(periods.map((_, j) => observed(s, j) ?? 0), i).avg3;
  const sellThroughRate = (s: SkuSeries, i: number) => {
    const recent = [i - 2, i - 1, i].filter(j => j >= 0).map(j => observed(s, j));
    // The trusted tile can anchor on an old sale. Three recorded calendar-month zeros
    // are direct evidence that its historical positive-sales rate is not moving this stock.
    return recent.length === 3 && recent.every(v => v !== null && v <= 0) ? 0 : rate(s, i);
  };
  const ims = (members: SkuSeries[], indices: number[]) => sum(members.flatMap(s => indices.map(i => observed(s, i) ?? 0)));
  const currentIndices = w.months.map(p => monthIndexOf(periods, p.year, p.month));
  const priorIndices = w.months.map(p => monthIndexOf(periods, p.year - 1, p.month));
  const priorEnd = monthIndexOf(periods, end.year - 1, end.month);
  const priorAvailable = priorIndices.every(i => i >= 0) && selected.some(s => priorIndices.some(i => observed(s, i) !== null));
  const stock = (members: SkuSeries[], i: number) => i < 0 ? 0 : sum(members.map(s => s.months[i].closing));
  const atRate = (members: SkuSeries[], i: number) => sum(members.map(s => rate(s, i)));
  const values = (members: SkuSeries[], indices: number[], idx: number): Record<PackagingMetric, number> => {
    const rr = atRate(members, idx), balance = stock(members, idx);
    const cells = members.flatMap(s => indices.filter(i => i >= 0).map(i => s.months[i]));
    return {
      runRate: rr, ims: ims(members, indices), forecast: sum(cells.map(c => c.forecast)),
      production: sum(cells.map(c => c.actualProduction)), arrival: sum(cells.map(c => c.arrivals)),
      stock: balance, cover: rr > 0 ? Math.max(0, balance) / rr * weeksPerMonth : 0,
      selloutValue: sum(members.map(s => ims([s], indices) * num(s.sku.priceToWs))),
      stockValue: sum(members.map(s => (idx < 0 ? 0 : s.months[idx].closing) * num(s.sku.priceToWs))),
    };
  };
  const countryValues = values(selected, currentIndices, w.toIdx);
  const groups = (["Old", "New"] as Packaging[]).flatMap(packaging => {
    const members = selected.filter(s => packagingOf(s.sku) === packaging);
    if (!members.length) return [];
    const current = values(members, currentIndices, w.toIdx), prior = values(members, priorIndices, priorEnd);
    const metrics = Object.fromEntries((Object.keys(current) as PackagingMetric[]).map(key => {
      const ly = priorAvailable && (key !== "cover" || prior.runRate > 0) ? prior[key] : null;
      const figure: PackagingFigure = { value: round(current[key], 2), sharePct: key === "cover" ? ratio(current.stock, countryValues.stock) : ratio(current[key], countryValues[key]), lastYear: ly === null ? null : round(ly, 2), changePct: key === "cover" && current.runRate <= 0 ? null : change(current[key], ly) };
      return [key, figure];
    })) as Record<PackagingMetric, PackagingFigure>;
    const aggregate = clearOutProjection(current.stock, current.runRate, end.year, end.month);
    const clearance = members.filter(s => s.months[w.toIdx].closing > 0).map(s => clearOutProjection(s.months[w.toIdx].closing, sellThroughRate(s, w.toIdx), end.year, end.month));
    const monthsToClear = clearance.some(c => c.monthsToClear === null) ? null : Math.max(0, ...clearance.map(c => c.monthsToClear ?? 0));
    const projectedClearMonth = monthsToClear === null ? null : clearance.reduce((latest, projection) =>
      projection.projectedClearMonth && projection.projectedClearMonth > latest ? projection.projectedClearMonth : latest,
    `${end.year}-${String(end.month).padStart(2, "0")}`);
    return [{ packaging, skuCount: members.length, metrics, aggregateMonthsAtRate: aggregate.monthsToClear, monthsToClear,
      projectedClearMonth }];
  });
  const months = periods.slice(Math.max(0, w.toIdx - 23), w.toIdx + 1).map(p => {
    const i = monthIndexOf(periods, p.year, p.month);
    const byPack = (pack: Packaging) => {
      const points = selected.filter(s => packagingOf(s.sku) === pack).map(s => observed(s, i)).filter((v): v is number => v !== null);
      return points.length ? sum(points) : null;
    };
    const oldIms = byPack("Old"), newIms = byPack("New"), total = (oldIms ?? 0) + (newIms ?? 0);
    return { month: `${p.year}-${String(p.month).padStart(2, "0")}`, label: p.label, oldIms, newIms, oldSharePct: oldIms === null ? null : ratio(oldIms, total), newSharePct: newIms === null ? null : ratio(newIms, total) };
  });
  const pairsByKey = new Map<string, SkuSeries[]>();
  for (const s of selected) {
    const key = `${flavourOf(s.sku).toLowerCase()}|${s.sku.weight.toLowerCase()}`;
    pairsByKey.set(key, [...(pairsByKey.get(key) ?? []), s]);
  }
  const pairs = [...pairsByKey.values()].flatMap(members => {
    if (new Set(members.map(s => packagingOf(s.sku))).size < 2) return [];
    const total = ims(members, currentIndices);
    const side = (pack: Packaging): PackagingStock => {
      const skuMembers = members.filter(s => packagingOf(s.sku) === pack), rr = atRate(skuMembers, w.toIdx), balance = stock(skuMembers, w.toIdx), sales = ims(skuMembers, currentIndices);
      return { ims: sales, stock: round(balance, 2), runRate: rr, coverWeeks: rr > 0 ? round(Math.max(0, balance) / rr * weeksPerMonth, 2) : null, sharePct: ratio(sales, total) };
    };
    return [{ flavour: flavourOf(members[0].sku), weight: members[0].sku.weight, old: side("Old"), new: side("New") }];
  });
  const oldMembers = selected.filter(s => packagingOf(s.sku) === "Old");
  const stalled = oldMembers.flatMap(s => {
    const balance = s.months[w.toIdx].closing, rr = sellThroughRate(s, w.toIdx);
    return balance > 0 && (rr <= 0 || balance / rr > 6)
      ? [{ skuId: s.sku.id, sku: analysisSkuLabel(s.sku), weight: s.sku.weight, stock: round(balance, 2), runRate: rr, monthsToClear: clearOutProjection(balance, rr, end.year, end.month).monthsToClear }] : [];
  }).sort((a, b) => b.stock - a.stock);
  // Expiry rows are remaining batches as of today, not historical snapshots. Move their deadline
  // to the selected end month and cap FIFO availability at the selected SKU stock balance.
  const expiry = isIntlCountry(ds.country) ? oldMembers.flatMap(s => {
    const rr = sellThroughRate(s, w.toIdx);
    let cumulative = 0, remainingBalance = Math.max(0, s.months[w.toIdx].closing);
    return (ds.expiryRows ?? []).filter(b => b.skuId === s.sku.id && b.totalRemaining > 0)
      .sort((a, b) => a.productionDate.localeCompare(b.productionDate)).flatMap(b => {
        const production = new Date(b.productionDate);
        if (production.getFullYear() * 12 + production.getMonth() + 1 > end.year * 12 + end.month) return [];
        const remaining = Math.min(b.totalRemaining, remainingBalance);
        remainingBalance -= remaining;
        const deadline = new Date(b.expiryDate);
        const days = (deadline.getTime() - Date.UTC(end.year, end.month, 0)) / 86400000;
        const sellable = Math.max(0, rr * Math.max(0, days / 30.4375) - cumulative);
        cumulative += remaining;
        const atRiskMc = round(Math.max(0, remaining - sellable), 2);
        return atRiskMc > 0 ? [{ skuId: s.sku.id, sku: analysisSkuLabel(s.sku), weight: s.sku.weight, expiryDate: b.expiryDate, remainingMc: round(remaining, 2), atRiskMc }] : [];
      });
  }).sort((a, b) => b.atRiskMc - a.atRiskMc) : [];
  return { enabled, country: ds.country, asOf: `${end.year}-${String(end.month).padStart(2, "0")}`, groups, months, pairs, stalled, expiry, hasPrices: selected.some(s => num(s.sku.priceToWs) > 0), notes: [
    "All quantities start in MC. Shares use the active filtered selection; year-on-year uses the same calendar months. Auto-filled IMS, future sales and inactive SKUs are excluded.",
    "Packaging cover uses each pack's own trusted three-month IMS rate (4.3 weeks/month in Lebanon, 4 elsewhere), not the other pack's demand. No packaging stock is transferred.",
    "Aggregate months at rate = total stock / total pack rate. Complete clear-out uses the slowest stocked SKU at its own constant rate, with no future receipts. Any stocked SKU with no demand prevents a complete clear-out date; stock is never borrowed between flavours.",
    "Stalled Old stock means more than six months at its own rate, or positive stock with no sales.",
    "Three recorded zero-sales calendar months block a complete clear-out projection and use zero sell-through for expiry, even when the trusted running-rate tile still anchors on an older positive sale. Missing observations do not imply zero sales.",
    "Expiry risk uses remaining batch records available today, capped to the selected stock, and FIFO at the SKU's Old rate. Historical batch balances are not reconstructed.",
  ] };
}
