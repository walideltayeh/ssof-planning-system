import { buildStockLedger, stockPrecision as round, type StockDataset } from "../../shared/performance/stock";
import { fgProductionMap } from "../../shared/arrivalQuantities";
import { receivedFocMC } from "../../shared/focEntry";
import { resolveTrackerSku, trackerBusinessDate, isTrackerClearance, type Feed } from "../wsTracker";

type AuditSku = StockDataset["skus"][number] & { name: string; weight: string; packagingType?: string | null };
export type AuditDataset = Omit<StockDataset, "skus" | "ims" | "clearanceEvents"> & {
  skus: AuditSku[];
  ims: (StockDataset["ims"][number] & { source?: string; isActual?: boolean })[];
  clearanceEvents: (StockDataset["clearanceEvents"][number] & { id?: number; notes?: string | null; containerRef?: string | null })[];
};
type Cause = { skuId: number; sku: string; month: string; cause: string; mc: number; note: string };
const ym = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, "0")}`;
const n = (v: unknown) => Number(v) || 0;
const sum = (values: number[]) => round(values.reduce((a, b) => a + b, 0));
const label = (s: AuditSku) => `${s.name} ${s.weight} (${s.packagingType ?? "Missing packaging"})`;

/** Audits every stored Syria SKU, including inactive/unmapped records.
 * Net movements are NOT labelled warehouse stock. Missing balances stay null.
 * Cause sign is SSOF minus tracker, consistently across all sheets.
 */
export function buildSyriaSyncAudit(ds: AuditDataset, f: Feed & {
  warehouseBalances?: { flavour: string; format: string; month: string; closingStock: number }[];
}, suppliedReferences: Record<number, number> = {}) {
  if (ds.country !== "Syria" || f.country !== "Syria" || f.unit !== "MC") throw new Error("This audit is Syria only, in MC");
  const periods = ds.periods.filter(p => !p.country || p.country === "Syria").slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const byPeriod = new Map(periods.map(p => [p.id, ym(p)]));
  if (!periods.length) throw new Error("Syria has no planning periods; audit cannot calculate a chain");
  const byMonth = new Map(periods.map(p => [ym(p), p]));
  // Dormant SKUs are calculated for inspection but clearly excluded from app totals.
  const skus = ds.skus.filter(s => !s.country || s.country === "Syria");
  const ledger = buildStockLedger({ ...ds, skus: skus.map(s => ({ ...s, isActive: true })) });
  const production = fgProductionMap("Syria", ds.forecast, ds.actualProduction, ds.foc, ds.shipment);
  const causes: Cause[] = [], monthly: Record<string, string | number | null>[] = [];
  const diagnostics: Record<string, string | number | boolean>[] = [];
  const deliveries: Record<string, string | number>[] = [];
  const inside = (m: string) => m >= f.period.from && m <= f.period.to;
  const matching = (l: { flavour: string; format: string }, s: AuditSku) => resolveTrackerSku(l, skus)?.id === s.id;
  const end = byMonth.get(f.period.to);
  const summary = skus.map(s => {
    const trackerProducts = f.products.filter(p => matching(p, s));
    const ims = f.ims.filter(l => matching(l, s));
    const arrivals = f.arrivals.filter(l => matching(l, s));
    const moves = f.arrivalMovements.filter(l => matching(l, s));
    const events = ds.clearanceEvents.filter(e => e.skuId === s.id && (!e.country || e.country === "Syria"));
    const balances = ledger.bySku.get(s.id)!;
    const add = (month: string, cause: string, mc: number, note: string) => {
      if (round(mc)) causes.push({ skuId: s.id, sku: label(s), month, cause, mc: round(mc), note });
    };
    const firstOpening = balances.get(periods[0]?.id)?.opening ?? 0;
    add(ym(periods[0]), "Stored first-period opening", firstOpening, "Tracker opening is not published; this is a ledger contribution, not proof the opening is wrong.");
    for (const p of periods.filter(p => ym(p) <= f.period.to)) {
      const month = ym(p), b = balances.get(p.id)!;
      const ti = sum(ims.filter(l => l.month === month).map(l => l.qty));
      const ta = sum(arrivals.filter(l => l.month === month).map(l => l.qty));
      const recorded = ds.arrival.find(r => r.skuId === s.id && r.periodId === p.id);
      const weekly = sum([recorded?.week1, recorded?.week2, recorded?.week3, recorded?.week4].map(n));
      monthly.push({ skuId: s.id, sku: label(s), month, trackerIMS: ti, ssofIMS: b.ims,
        imsDifference: round(b.ims - ti), trackerInbound: ta, weeklyArrivalMirror: weekly,
        warehouseArrivals: b.arrivals, inboundDifference: round(b.arrivals - ta),
        opening: b.opening, adjustments: b.adjustments, closing: b.closing,
        trackerWarehouseStock: f.warehouseBalances?.some(x => x.month === month && matching(x, s))
          ? sum(f.warehouseBalances.filter(x => x.month === month && matching(x, s)).map(x => x.closingStock)) : null });
      add(month, "Planner adjustments", b.adjustments, "Recorded adjustment in the stock chain.");
      add(month, inside(month) ? "Recorded clearance minus tracker inbound" : "Clearance outside tracker coverage",
        b.arrivals - ta, "Only dated clearances enter Syria warehouse stock; weekly rows are a mirror.");
      add(month, inside(month) ? "Tracker IMS minus SSOF IMS" : "IMS outside tracker coverage",
        ti - b.ims, "A missing SSOF sale raises SSOF stock; an extra sale lowers it.");
      for (const r of ds.ims.filter(r => r.skuId === s.id && r.periodId === p.id)) {
        if (["auto_forecast", "forecast"].includes(r.source ?? "") && inside(month)) diagnostics.push({
          sku: label(s), month, kind: "Forecast-marked IMS inside tracker coverage", mc: n(r.value), isActual: r.isActual ?? false,
        });
        if (!inside(month) && n(r.value)) diagnostics.push({ sku: label(s), month, kind: "Nonzero IMS outside feed range", mc: n(r.value) });
      }
      if (!inside(month) && weekly) diagnostics.push({ sku: label(s), month, kind: "Weekly arrival outside feed range (not added to Syria stock)", mc: weekly });
      for (const r of ds.planningFg.filter(r => r.skuId === s.id && r.periodId === p.id)) {
        if (p.id !== periods[0]?.id && n(r.openingStock)) diagnostics.push({
          sku: label(s), month, kind: "Later opening ignored by carried stock chain", mc: n(r.openingStock),
        });
      }
    }
    const firstProduction = periods.find(p => (production.get(`${s.id}-${p.id}`) ?? 0) > 0);
    for (const mv of moves) deliveries.push({ sku: label(s), date: mv.date, mc: mv.qty,
      bucket: !byMonth.has(mv.date.slice(0, 7)) ? "Missing arrival period: overflow"
        : !firstProduction || mv.date.slice(0, 7) < ym(firstProduction) ? "Before first production / no production: kept by delivery date" : "Production-associated delivery" });
    for (const e of events) if (!byMonth.has(trackerBusinessDate(e.clearedDate).slice(0, 7)))
      diagnostics.push({ sku: label(s), month: trackerBusinessDate(e.clearedDate), kind: "Clearance ignored: missing arrival period or date", mc: n(e.clearedQty) });
    const trackerIMS = sum(ims.map(l => l.qty)), trackerInbound = sum(arrivals.map(l => l.qty));
    const ssofIMS = sum(ds.ims.filter(r => r.skuId === s.id && inside(byPeriod.get(r.periodId) ?? "")).map(r => n(r.value)));
    const ssofArrivals = sum(events.filter(e => n(e.clearedQty) > 0 && inside(trackerBusinessDate(e.clearedDate).slice(0, 7))
      && byMonth.has(trackerBusinessDate(e.clearedDate).slice(0, 7))).map(e => n(e.clearedQty)));
    const net = round(trackerInbound - trackerIMS), closing = end ? balances.get(end.id)!.closing : null;
    const balancesPublished = f.warehouseBalances?.filter(x => x.month === f.period.to && matching(x, s));
    const reference = balancesPublished?.length ? sum(balancesPublished.map(x => x.closingStock)) : suppliedReferences[s.id] ?? null;
    const explained = sum(causes.filter(c => c.skuId === s.id).map(c => c.mc));
    const movementGap = closing === null ? null : round(closing - net);
    if (movementGap !== null) add(f.period.to, "Unexplained movement reconciliation", movementGap - explained, "Residual remains explicitly visible.");
    const legacyFoc = sum((ds.foc ?? []).filter(c => c.skuId === s.id && (byPeriod.get(c.periodId) ?? "9999") <= f.period.to).map(receivedFocMC));
    return { skuId: s.id, sku: label(s), active: s.isActive !== false, excludedFromTotals: s.isExcludedFromTotal ?? false,
      trackerProducts: trackerProducts.map(p => `${p.flavour} ${p.format}`).join("; ") || "Not carried by tracker",
      trackerIMS, ssofIMS, imsDifference: round(ssofIMS - trackerIMS),
      trackerInbound, ssofArrivals, inboundDifference: round(ssofArrivals - trackerInbound),
      trackerMovementNetNotStock: net, trackerWarehouseStock: reference,
      warehouseReference: balancesPublished?.length ? "Published feed balance" : reference !== null ? "User-supplied reference" : "Not published; cannot verify",
      ssofClosing: closing, warehouseDifference: reference === null || closing === null ? null : round(closing - reference),
      stockMinusMovementNet: movementGap, explainedMovementDifference: explained,
      unexplainedMovementDifference: movementGap === null ? null : round(movementGap - explained),
      legacyReceivedFocAddition: legacyFoc, obsoleteFormulaClosing: closing === null ? null : round(closing + legacyFoc),
      firstOpening, firstPeriod: periods[0] ? ym(periods[0]) : "Missing",
      adjustments: sum([...balances].filter(([id]) => (byPeriod.get(id) ?? "") <= f.period.to).map(([, b]) => b.adjustments)),
      overflow: sum(moves.filter(m => !byMonth.has(m.date.slice(0, 7))).map(m => m.qty)),
      beforeProduction: sum(moves.filter(m => !firstProduction || m.date.slice(0, 7) < ym(firstProduction)).map(m => m.qty)),
      nonTrackerClearances: sum(events.filter(e => !isTrackerClearance(e)).map(e => n(e.clearedQty))),
    };
  });
  const unmapped = f.products.filter(p => !resolveTrackerSku(p, skus)).map(p => ({
    product: `${p.flavour} ${p.format}`,
    ims: sum(f.ims.filter(l => l.flavour === p.flavour && l.format === p.format).map(l => l.qty)),
    inbound: sum(f.arrivals.filter(l => l.flavour === p.flavour && l.format === p.format).map(l => l.qty)),
  }));
  return { from: f.period.from, to: f.period.to, generatedAt: f.generatedAt, summary, monthly, causes, diagnostics, deliveries, unmapped };
}
