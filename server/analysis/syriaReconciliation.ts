import type { SyriaReconciliation, SyriaReconciliationLine, ReconciliationBreakdown, ReconciliationCause, ReconciliationDetail } from "../../shared/performance/syriaReconciliation";
import { buildStockLedger, stockPrecision as round } from "../../shared/performance/stock";
import type { PerformanceDataset, DatasetSku } from "./countryPerformance.helpers";
import { SKU_MAP, fetchFeed, type Feed, type FeedLine } from "../wsTracker";
import * as db from "../db";

// Optional, explicit feed contract. These balances must be published by the
// tracker; they must NEVER be reconstructed from IMS, production or deliveries.
export type WarehouseBalance = {
  flavour: string; format: string; month: string; closingStock: number;
  openingMonth?: string; openingStock?: number;
};
export type ReconciliationFeed = Feed & { warehouseBalances?: WarehouseBalance[] };
const ym = (p: { year: number; month: number }) => `${p.year}-${String(p.month).padStart(2, "0")}`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const label = (s: DatasetSku) => `${s.name} ${s.weight} (${s.packagingType ?? "New"})`;
const sum = (values: number[]) => round(values.reduce((a, b) => a + b, 0));
const causes: [ReconciliationCause, string][] = [
  ["uncleared", "Tracker deliveries without a recorded clearance"],
  ["dated", "Clearance dated in another month"],
  ["opening", "Opening stock difference"],
  ["adjustments", "Planner adjustments"],
  ["unmapped", "Tracker products not mapped to an SSOF SKU"],
  ["outside", "Tracker months outside SSOF's periods"],
  ["inactive", "Inactive SSOF SKUs still present in the tracker"],
  ["excluded", "SSOF SKUs explicitly excluded from totals"],
  ["ssofOnly", "SSOF quantities not represented in the tracker"],
  ["unexplained", "Unexplained"],
];
const buckets = (): ReconciliationBreakdown[] => causes.map(([cause, title]) => ({
  cause, label: title, mc: 0, note: "", details: [],
}));
const add = (rows: ReconciliationBreakdown[], cause: ReconciliationCause, detail: ReconciliationDetail) => {
  const row = rows.find(r => r.cause === cause)!;
  row.details.push(detail);
  row.mc = round((row.mc ?? 0) + detail.mc);
};

/** This identity is enforced for every known headline, including residuals. */
export function finishBreakdown(difference: number | null, rows: ReconciliationBreakdown[]) {
  const residual = rows.find(r => r.cause === "unexplained")!;
  residual.mc = difference === null ? null : round(difference - sum(rows.filter(r => r !== residual).map(r => r.mc ?? 0)));
  residual.note = difference === null
    ? "The tracker has not supplied the balance, so the gap cannot be measured."
    : residual.mc !== 0 ? "Not established by the available source records. Includes any missing opening balance or tracker-side adjustments; do not assume production arrived." : "Every mastercase in the headline difference is accounted for.";
  if (residual.mc !== null) {
    const undocumented = round(residual.mc - sum(residual.details.map(d => d.mc)));
    if (undocumented) residual.details.push({
      sku: "Source totals / missing supporting records", month: "Compared period", mc: undocumented,
      note: "No product-level evidence identifies this remainder. It has not been attributed to a SKU or to production.",
    });
  }
  return rows;
}

export function resolveTrackerSku(l: { flavour: string; format: string }, skus: DatasetSku[]) {
  const map = SKU_MAP.find(m => norm(m.flavour) === norm(l.flavour) && norm(m.format).replace(/^1kg$/, "kg") === norm(l.format).replace(/^1kg$/, "kg"));
  if (!map) return undefined;
  return skus.find(s => norm(s.name) === norm(map.name) && s.weight === map.weight
    && (!map.packagingType || (s.packagingType ?? "New") === map.packagingType));
}

export function buildSyriaReconciliation(ds: PerformanceDataset, f: ReconciliationFeed, requested: { from: string; to: string }): SyriaReconciliation {
  if (ds.country !== "Syria" || f.country !== "Syria") throw new Error("Reconciliation is Syria only");
  if (f.unit !== "MC") throw new Error("The Syria tracker feed must supply mastercases");
  const validMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
  if (!validMonth(f.period.from) || !validMonth(f.period.to)
    || [...f.ims, ...f.arrivals].some(l => !validMonth(l.month) || !Number.isFinite(l.qty))
    || (f.arrivalMovements ?? []).some(l => !validMonth(l.date.slice(0, 7)) || !Number.isFinite(l.qty))
    || f.warehouseBalances?.some(b => !validMonth(b.month) || !Number.isFinite(b.closingStock) || (b.openingStock !== undefined && !Number.isFinite(b.openingStock)))) {
    throw new Error("The tracker quantities or dates are invalid");
  }
  const allSkus = [...ds.skus, ...(ds.inactiveSkus ?? []).filter(s => !ds.skus.some(a => a.id === s.id))]
    .filter(s => !("country" in s) || s.country === "Syria");
  const periods = ds.periods.filter(p => !("country" in p) || p.country === "Syria").slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const byId = new Map(periods.map(p => [p.id, ym(p)]));
  const periodSet = new Set(periods.map(ym));
  const from = requested.from > f.period.from ? requested.from : f.period.from;
  const to = requested.to < f.period.to ? requested.to : f.period.to;
  const inside = (month: string) => month >= from && month <= to;
  const scope = `Whole Syria, including tracker products that are not mapped. Analysis SKU filters do not restrict this comparison. Selected dates: ${requested.from}–${requested.to}; tracker coverage: ${f.period.from}–${f.period.to}. Only shared dates are compared. Difference = WS Tracker minus SSOF.`;
  if (from > to) return {
    status: "unavailable", error: "The selected dates do not overlap the tracker feed.",
    from: requested.from, to: requested.to, generatedAt: f.generatedAt, checkedAt: new Date().toISOString(),
    scope, lines: [], mappedIms: null, conclusion: "No shared period is available for comparison.",
    warning: true, pendingProduction: [], ignoredOpeningEntries: [], chainStart: periods[0] ? ym(periods[0]) : null,
  };
  const eligible = (s: DatasetSku) => s.isActive !== false && !s.isExcludedFromTotal;
  const classify = (l: FeedLine): ReconciliationCause | null => {
    const s = resolveTrackerSku(l, allSkus);
    if (!s) return "unmapped";
    if (!periodSet.has(l.month)) return "outside";
    if (s.isActive === false) return "inactive";
    if (s.isExcludedFromTotal) return "excluded";
    return null;
  };
  const makeLine = (id: SyriaReconciliationLine["id"], title: string, tracker: number | null, ssof: number | null, rows = buckets(), missing: string[] = []): SyriaReconciliationLine => {
    const difference = tracker === null || ssof === null ? null : round(tracker - ssof);
    return { id, label: title, tracker, ssof, difference, ties: difference === null ? null : difference === 0, breakdown: finishBreakdown(difference, rows), missing };
  };
  const detail = (s: DatasetSku | undefined, month: string, mc: number, note: string, fallback = "Unmapped product"): ReconciliationDetail => ({
    sku: s ? label(s) : fallback, skuId: s?.id, month, mc: round(mc), note,
  });
  const imsRows = buckets(), arrivalRows = buckets();
  for (const [lines, rows] of [[f.ims, imsRows], [f.arrivals, arrivalRows]] as const) {
    for (const l of lines.filter(l => inside(l.month))) {
      const cause = classify(l);
      if (cause) add(rows, cause, detail(resolveTrackerSku(l, allSkus), l.month, l.qty, "The tracker counts this quantity; SSOF's active stock scope does not.", `${l.flavour} ${l.format}`));
    }
  }
  const trackerMappedIds = new Set([...f.ims, ...f.arrivals, ...f.products.map(p => ({ ...p, month: from, qty: 0 }))].map(l => resolveTrackerSku(l, allSkus)?.id).filter((id): id is number => id !== undefined));
  const allIms = [...ds.ims, ...(ds.inactiveIms ?? []).filter(r => !ds.ims.some(a => a.skuId === r.skuId && a.periodId === r.periodId))];
  const selectedIms = allIms.filter(r => inside(byId.get(r.periodId) ?? "") && allSkus.some(s => s.id === r.skuId && eligible(s)));
  const trackerIms = sum(f.ims.filter(l => inside(l.month)).map(l => l.qty));
  const ssofIms = sum(selectedIms.map(r => Number(r.value) || 0));
  const ssofMappedIms = sum(selectedIms.filter(r => trackerMappedIds.has(r.skuId)).map(r => Number(r.value) || 0));
  const trackerEligibleIms = sum(f.ims.filter(l => inside(l.month) && !classify(l)).map(l => l.qty));
  for (const r of selectedIms) {
    if (!trackerMappedIds.has(r.skuId) && Number(r.value)) add(imsRows, "ssofOnly", detail(allSkus.find(s => s.id === r.skuId), byId.get(r.periodId)!, -Number(r.value), "This sell-out remains in SSOF's stock chain; the tracker does not publish this product."));
  }
  // Residual IMS differences remain traceable by SKU/month, never re-labelled
  // as production or arrivals simply because aggregate sell-out matches.
  const mappedCells = new Map<string, number>();
  for (const l of f.ims.filter(l => inside(l.month) && !classify(l))) {
    const s = resolveTrackerSku(l, allSkus)!;
    const k = `${s.id}|${l.month}`;
    mappedCells.set(k, (mappedCells.get(k) ?? 0) + l.qty);
  }
  for (const r of selectedIms.filter(r => trackerMappedIds.has(r.skuId))) {
    const k = `${r.skuId}|${byId.get(r.periodId)}`;
    mappedCells.set(k, (mappedCells.get(k) ?? 0) - (Number(r.value) || 0));
  }
  for (const [k, v] of mappedCells) if (round(v)) {
    const [id, month] = k.split("|");
    add(imsRows, "unexplained", detail(allSkus.find(s => s.id === Number(id)), month, v, "Recorded monthly sell-out differs between the two sources."));
  }
  type Receipt = { skuId: number; month: string; date: string; qty: number };
  const trackerReceipts: Receipt[] = (f.arrivalMovements ?? []).flatMap(m => {
    const s = resolveTrackerSku(m, allSkus);
    return s && eligible(s) && periodSet.has(m.date.slice(0, 7)) ? [{ skuId: s.id, month: m.date.slice(0, 7), date: m.date.slice(0, 10), qty: m.qty }] : [];
  });
  const ssofReceipts: Receipt[] = ds.clearanceEvents.flatMap(e => {
    if ("country" in e && e.country !== "Syria") return [];
    const s = allSkus.find(s => s.id === e.skuId);
    const date = e.clearedDate instanceof Date ? e.clearedDate.toISOString().slice(0, 10) : String(e.clearedDate ?? "").slice(0, 10);
    return s && eligible(s) && periodSet.has(date.slice(0, 7)) && Number(e.clearedQty) > 0
      ? [{ skuId: s.id, month: date.slice(0, 7), date, qty: Number(e.clearedQty) }] : [];
  });
  const ssofArrivals = sum(ssofReceipts.filter(r => inside(r.month)).map(r => r.qty));
  for (const t of trackerReceipts) {
    for (const s of ssofReceipts.filter(s => s.skuId === t.skuId && s.date === t.date && s.qty > 0)) {
      const matched = Math.min(t.qty, s.qty);
      t.qty = round(t.qty - matched); s.qty = round(s.qty - matched);
    }
  }
  // Only unique, same-product/same-quantity residual pairs are evidence of a
  // possible date shift. Repeated ambiguous quantities are left unexplained.
  for (const t of trackerReceipts.filter(r => r.qty > 0)) {
    const matches = ssofReceipts.filter(s => s.skuId === t.skuId && s.qty === t.qty && s.month !== t.month);
    const duplicates = trackerReceipts.filter(s => s.skuId === t.skuId && s.qty === t.qty);
    if (matches.length === 1 && duplicates.length === 1) {
      const s = matches[0], qty = t.qty;
      const mc = (inside(t.month) ? qty : 0) - (inside(s.month) ? qty : 0);
      if (inside(t.month) || inside(s.month)) add(arrivalRows, "dated", {
        ...detail(allSkus.find(sku => sku.id === t.skuId), t.month, mc, `Same SKU and ${qty} MC, but tracker delivery ${t.date} versus clearance ${s.date}. Verify the delivery identity; quantity matching alone is not proof.`),
        trackerMonth: t.month, ssofMonth: s.month,
      });
      t.qty = 0; s.qty = 0;
    }
  }
  for (const t of trackerReceipts.filter(r => r.qty > 0 && inside(r.month))) {
    // If a same-month receipt remains, the records differ within a month,
    // not in closing stock. Keep it unexplained rather than claiming non-arrival.
    const sameMonth = ssofReceipts.some(s => s.skuId === t.skuId && s.month === t.month && s.qty > 0);
    add(arrivalRows, sameMonth ? "unexplained" : "uncleared", detail(allSkus.find(s => s.id === t.skuId), t.month, t.qty, `The tracker records a physical delivery on ${t.date}; no matching clearance is recorded.`));
  }
  for (const s of ssofReceipts.filter(r => r.qty > 0 && inside(r.month))) {
    add(arrivalRows, trackerMappedIds.has(s.skuId) ? "unexplained" : "ssofOnly", detail(allSkus.find(sku => sku.id === s.skuId), s.month, -s.qty, `SSOF counts a clearance on ${s.date}; no matching tracker delivery is published.`));
  }
  const ledger = buildStockLedger({ ...ds, skus: allSkus });
  const end = periods.find(p => ym(p) === to), start = periods.find(p => ym(p) === from);
  const opening = start ? sum(allSkus.filter(eligible).map(s => ledger.bySku.get(s.id)?.get(start.id)?.opening ?? 0)) : null;
  const closing = end ? ledger.totals.get(end.id)! : null;
  const balances = f.warehouseBalances?.filter(b => b.month === to);
  const missingStock = !balances?.length || f.products.some(p => !balances.some(b => norm(b.flavour) === norm(p.flavour) && norm(b.format) === norm(p.format)));
  const stock = missingStock ? null : sum(balances!.map(b => b.closingStock));
  const warehouseRows = buckets();
  const warehouseResidual = warehouseRows.find(r => r.cause === "unexplained")!;
  for (const r of arrivalRows.filter(r => r.cause !== "unexplained")) for (const d of r.details) add(warehouseRows, r.cause, { ...d });
  for (const r of imsRows.filter(r => r.cause !== "unexplained")) for (const d of r.details) add(warehouseRows, r.cause, { ...d, mc: -d.mc, note: `Sell-out stock effect: ${d.note}` });
  // Known monthly IMS differences also affect stock, but retain their honest label.
  const imsResidual = imsRows.find(r => r.cause === "unexplained")!;
  if (imsResidual.details.length) {
    for (const d of imsResidual.details) add(warehouseRows, "ssofOnly", { ...d, mc: -d.mc, note: `Different recorded sell-out: ${d.note}` });
  }
  const openingRow = warehouseRows.find(r => r.cause === "opening")!;
  const openingKnown = !missingStock && balances!.every(b => b.openingMonth === from && typeof b.openingStock === "number") && opening !== null;
  if (openingKnown) {
    openingRow.mc = round(sum(balances!.map(b => b.openingStock!)) - opening!);
    openingRow.note = `Published tracker opening at ${from} minus SSOF's carried opening at the same month.`;
    for (const b of balances!) {
      const s = resolveTrackerSku(b, allSkus);
      const ssof = s && eligible(s) && start ? ledger.bySku.get(s.id)?.get(start.id)?.opening ?? 0 : 0;
      openingRow.details.push(detail(s, from, b.openingStock! - ssof, "Tracker opening minus SSOF carried opening.", `${b.flavour} ${b.format}`));
    }
    for (const s of allSkus.filter(s => eligible(s) && !balances!.some(b => resolveTrackerSku(b, allSkus)?.id === s.id))) {
      const value = start ? ledger.bySku.get(s.id)?.get(start.id)?.opening ?? 0 : 0;
      if (value) openingRow.details.push(detail(s, from, -value, "SSOF opening for a product outside the published tracker balance scope."));
    }
  } else {
    openingRow.mc = null;
    openingRow.note = `The tracker must publish per-product opening balances for ${from}; none are inferred.`;
  }
  for (const p of ds.planningFg.filter(p => inside(byId.get(p.periodId) ?? "") && Number(p.adjustments) && allSkus.some(s => s.id === p.skuId && eligible(s)))) {
    add(warehouseRows, "adjustments", detail(allSkus.find(s => s.id === p.skuId), byId.get(p.periodId)!, -Number(p.adjustments), "A positive SSOF planner adjustment raises SSOF stock and reduces the tracker-minus-SSOF difference. Tracker-side adjustments, if any, remain unexplained."));
  }
  if (stock !== null) {
    // Allocate the unexplained balance to actual published product balances.
    // No product is assigned an invented warehouse quantity.
    const perProduct = new Map<string, { s?: DatasetSku; tracker: number; name: string }>();
    for (const b of balances!) {
      const s = resolveTrackerSku(b, allSkus), name = s ? label(s) : `${b.flavour} ${b.format}`;
      const entry = perProduct.get(name) ?? { s, tracker: 0, name };
      entry.tracker += b.closingStock;
      perProduct.set(name, entry);
    }
    for (const s of allSkus.filter(eligible)) if (!perProduct.has(label(s))) perProduct.set(label(s), { s, tracker: 0, name: label(s) });
    for (const p of perProduct.values()) {
      const ssof = p.s && eligible(p.s) && end ? ledger.bySku.get(p.s.id)?.get(end.id)?.closing ?? 0 : 0;
      const accounted = sum(warehouseRows.filter(r => r !== warehouseResidual).flatMap(r => r.details.filter(d => d.sku === p.name).map(d => d.mc)));
      const residual = round(p.tracker - ssof - accounted);
      if (residual) warehouseResidual.details.push(detail(p.s, to, residual, "Published tracker balance minus SSOF closing, less identified effects. Any missing opening balance or tracker adjustment remains unverified.", p.name));
    }
  }
  const lines = [
    makeLine("ims", "Sell-out (IMS), all active SSOF SKUs", trackerIms, ssofIms, imsRows),
    makeLine("arrivals", "Physical inbound / recorded arrivals", sum(f.arrivals.filter(l => inside(l.month)).map(l => l.qty)), ssofArrivals, arrivalRows),
    makeLine("warehouse", "Warehouse stock at the end of the period", stock, closing, warehouseRows,
      [...(missingStock ? [`Per-product warehouse closing balances for ${to}`] : []), ...(!openingKnown ? [`Per-product warehouse opening balances for ${from}, with their opening month`] : []), ...(!end ? [`SSOF period ${to}`] : [])]),
  ];
  const pendingProduction: ReconciliationDetail[] = [];
  for (const s of allSkus.filter(eligible)) for (const p of periods.filter(p => inside(ym(p)))) {
    const override = Number(ds.actualProduction.find(r => r.skuId === s.id && r.periodId === p.id)?.value) || 0;
    const sh = ds.shipment.find(r => r.skuId === s.id && r.periodId === p.id);
    const produced = override > 0 ? override : sum([sh?.week1, sh?.week2, sh?.week3, sh?.week4].map(v => Number(v) || 0));
    const cleared = sum(ds.clearanceEvents.filter(e => e.skuId === s.id && e.periodId === p.id).map(e => Number(e.clearedQty) || 0));
    if (produced > cleared) pendingProduction.push(detail(s, ym(p), produced - cleared, `${produced} MC produced; ${cleared} MC clearance attached to this production batch. Not evidence of arrival at the warehouse.`));
  }
  const ignoredOpeningEntries = ds.planningFg.filter(r => r.periodId !== periods[0]?.id && Number(r.openingStock) && allSkus.some(s => s.id === r.skuId && eligible(s))).map(r =>
    detail(allSkus.find(s => s.id === r.skuId), byId.get(r.periodId) ?? "Unknown month", Number(r.openingStock), "A later opening entry is not used: the existing chain carries the previous month's closing stock. This amount is a diagnostic, not a contribution to the gap."));
  const mappedTies = trackerEligibleIms === ssofMappedIms;
  const imsTies = lines[0].ties === true;
  const missingReceipts = arrivalRows.find(r => r.cause === "uncleared")!.mc ?? 0;
  let conclusion = imsTies || mappedTies ? `Sell-out matches the tracker${imsTies ? "" : " for mapped products only"}; ` : "Sell-out does not match the tracker; ";
  if (lines[1].ties === false && missingReceipts > 0) conclusion += `the arrivals gap includes ${missingReceipts} MC of tracker-confirmed deliveries without clearance.`;
  else if (lines[1].ties === false) conclusion += "arrivals differ. See the dated receipts and unexplained amounts below.";
  else if (stock === null) conclusion += "arrivals match, but warehouse stock cannot be checked because the feed has no published warehouse balance.";
  else if (lines[2].ties === false) conclusion += "warehouse stock differs. See opening balances, adjustments and the unexplained remainder below.";
  else conclusion += "arrivals and warehouse stock match.";
  if (mappedTies && !imsTies) conclusion += ` Full SSOF sell-out includes ${round(ssofIms - ssofMappedIms)} MC outside that matched product scope.`;
  const offsetting = lines.some(l => l.ties === true && l.breakdown.some(b => b.cause === "dated" ? b.details.length > 0 : b.details.some(d => d.mc !== 0)));
  if (offsetting) conclusion += " Some SKU/month differences offset one another even though the total ties; check their individual records.";
  return {
    status: "available", from, to, generatedAt: f.generatedAt, checkedAt: new Date().toISOString(), scope, lines,
    mappedIms: { tracker: trackerEligibleIms, ssof: ssofMappedIms, ties: mappedTies }, conclusion,
    warning: lines.some(l => l.ties !== true) || offsetting, pendingProduction, ignoredOpeningEntries, chainStart: periods[0] ? ym(periods[0]) : null,
  };
}

export async function loadSyriaReconciliation(ds: PerformanceDataset, window: { from: { year: number; month: number }; to: { year: number; month: number } }): Promise<SyriaReconciliation> {
  try {
    const [feed, allSkus] = await Promise.all([
      fetchFeed(AbortSignal.timeout(8000)),
      db.getSkusForCountry("Syria", true),
    ]);
    // Normal planning queries intentionally omit inactive SKUs. Read the Syria
    // master list only for identifying tracker products that became inactive.
    const inactiveSkus = allSkus.filter(s => s.isActive === false && !ds.skus.some(a => a.id === s.id));
    return buildSyriaReconciliation({ ...ds, inactiveSkus }, feed, { from: ym(window.from), to: ym(window.to) });
  } catch {
    // Never turn a failed fetch into zero stock or return a previous balance as fresh.
    return {
      status: "unavailable", error: "The live WS Tracker feed could not be read or its data was invalid. Retry Refresh; no tracker quantities have been assumed.",
      from: ym(window.from), to: ym(window.to), generatedAt: null, checkedAt: new Date().toISOString(),
      scope: "Whole Syria only.", lines: [], mappedIms: null, conclusion: "Tracker comparison unavailable; SSOF stock inputs are unchanged.",
      warning: true, pendingProduction: [], ignoredOpeningEntries: [], chainStart: null,
    };
  }
}
