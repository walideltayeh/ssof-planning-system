import { mcPrecision, type FocCell } from "./performance/foc";
import { recordedFocLines, receivedFocMC, type FocMatchSku, type FocMatchPeriod } from "./focEntry";

export type FocMove = { sourceSkuId: number; targetSkuId: number; periodIds?: number[] };
export function reassignFocCells(country: string, skus: FocMatchSku[], periods: FocMatchPeriod[], cells: FocCell[], move: FocMove) {
  const source = skus.find(s => s.id === move.sourceSkuId && s.isActive !== false && (!s.country || s.country === country));
  const target = skus.find(s => s.id === move.targetSkuId && s.isActive !== false && (!s.country || s.country === country));
  if (!source || !target) throw new Error("Choose two active SKUs from this country.");
  if (source.id === target.id) throw new Error("Choose a different target SKU.");
  if (move.periodIds && (!move.periodIds.length || move.periodIds.some(id => !periods.some(p => p.id === id && (!p.country || p.country === country)))))
    throw new Error("Choose at least one valid month from this country.");
  const next = new Map(cells.map(c => [`${c.skuId}-${c.periodId}`, c]));
  const selected = new Set(move.periodIds ?? periods.map(p => p.id));
  const total = (id: number) => mcPrecision(cells.filter(c => c.skuId === id).reduce((sum, c) => sum + (Number(c.value) || 0), 0));
  const months = periods.filter(p => selected.has(p.id)).map(period => {
    const sourceKey = `${source.id}-${period.id}`, targetKey = `${target.id}-${period.id}`;
    const from = next.get(sourceKey);
    if (!from || (from.value === null && !from.lines?.length)) return null;
    const to = next.get(targetKey) ?? { skuId: target.id, periodId: period.id, country, value: null };
    const sourceBefore = Number(from.value) || 0, targetBefore = Number(to.value) || 0;
    const targetAfter = mcPrecision(sourceBefore + targetBefore);
    if (targetAfter > 9999999999.99) throw new Error("The combined target FOC quantity exceeds the maximum. Nothing was moved.");
    // Legacy monthly balances lack line identifiers; assign a stable, source-specific identifier before merging.
    const materialize = (c: FocCell) => recordedFocLines(c).map(l => ({ ...l,
      id: l.id === "existing" ? `existing:${c.skuId}:${c.periodId}` : l.id }));
    const sourceLines = materialize(from), targetLines = materialize(to);
    const lines = [...targetLines, ...sourceLines];
    if (new Set(lines.map(l => l.id)).size !== lines.length) throw new Error("Duplicate recorded line identifiers. Review these records before moving.");
    if (mcPrecision(lines.reduce((sum, l) => sum + l.quantityMC, 0)) !== targetAfter)
      throw new Error("The recorded lines do not match the monthly balance. Review this cell before moving.");
    const combined = { ...to, country, value: targetAfter.toFixed(2), lines };
    next.set(targetKey, { ...combined, received: targetAfter > 0 && receivedFocMC(combined) === targetAfter });
    next.set(sourceKey, { ...from, value: null, received: false, lines: [] });
    return { periodId: period.id, month: period.label, quantityMC: sourceBefore, receivedMC: receivedFocMC(from),
      sourceBefore, sourceAfter: 0, targetBefore, targetAfter, sourceLineCount: sourceLines.length,
      targetLineCount: targetLines.length, resultLineCount: lines.length };
  }).filter((m): m is NonNullable<typeof m> => m !== null);
  if (!months.length) throw new Error("No FOC entries exist in the selected source months.");
  const moved = mcPrecision(months.reduce((sum, m) => sum + m.quantityMC, 0));
  const label = (s: FocMatchSku) => `${s.name} · ${s.weight} · ${s.packagingType ?? "New"}`;
  return { next, move: { sourceSku: label(source), targetSku: label(target),
    sourceTotalBefore: total(source.id), sourceTotalAfter: mcPrecision(total(source.id) - moved),
    targetTotalBefore: total(target.id), targetTotalAfter: mcPrecision(total(target.id) + moved), months } };
}
