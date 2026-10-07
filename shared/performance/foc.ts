export type FocCountry = "Libya" | "Syria";
export type FocCell = { skuId: number; periodId: number; value: string | number | null; updatedAt?: Date | string | null;
  received?: boolean; receivedDate?: string | null; receiptDecision?: string; receiptReviewKey?: string | null; country?: string };
export const supportsFoc = (country: string): country is FocCountry => country === "Libya" || country === "Syria";
export const focNote = "FOC is free product, not sell-out or revenue. Only confirmed, duplicate-checked FOC receipts enter stock when Include FOC is on. Awaiting FOC is not stock.";
export const mcPrecision = (v: number) => Math.round(v * 100) / 100;
export type FocSummaryRow = {
  label: string; ordered: number; foc: number | null; enteredFoc: number;
  physical: number | null; knownPhysical: number; percent: number | null; missing: number;
};
export type FocSummary = {
  receipts?: import("./focReceipts").FocReceiptSummary;
  includeFoc: boolean; basisLabel: string; note: string;
  months: (FocSummaryRow & { periodId: number })[];
  skus: (FocSummaryRow & { skuId: number; weight: string; packaging: string })[];
  total: FocSummaryRow;
};
export function summarizeFoc(
  skus: { id: number; name: string; weight: string; packagingType?: string | null; isActive?: boolean; isExcludedFromTotal?: boolean | null }[],
  periods: { id: number; label: string }[],
  forecast: FocCell[], foc: FocCell[], includeFoc: boolean,
): FocSummary {
  const active = skus.filter(s => s.isActive !== false && !s.isExcludedFromTotal);
  const ordered = new Map(forecast.map(c => [`${c.skuId}:${c.periodId}`, Number(c.value) || 0]));
  const free = new Map(foc.filter(c => c.value !== null).map(c => [`${c.skuId}:${c.periodId}`, Number(c.value)]));
  const row = (label: string, ids: number[], ps: number[]): FocSummaryRow => {
    let paid = 0, entered = 0, missing = 0;
    for (const id of ids) for (const p of ps) {
      paid += ordered.get(`${id}:${p}`) ?? 0;
      const value = free.get(`${id}:${p}`);
      if (value === undefined) missing++; else entered += value;
    }
    paid = mcPrecision(paid); entered = mcPrecision(entered);
    return { label, ordered: paid, foc: missing ? null : entered, enteredFoc: entered,
      physical: includeFoc && missing ? null : mcPrecision(paid + (includeFoc ? entered : 0)),
      knownPhysical: mcPrecision(paid + (includeFoc ? entered : 0)),
      percent: !missing && paid > 0 ? mcPrecision(entered / paid * 100) : null, missing };
  };
  const total = row("Total", active.map(s => s.id), periods.map(p => p.id));
  return {
    includeFoc, basisLabel: includeFoc ? `Including entered FOC${total.missing ? " — FOC incomplete" : ""}` : "Ordered volume only — excluding FOC",
    note: focNote,
    months: periods.map(p => ({ ...row(p.label, active.map(s => s.id), [p.id]), periodId: p.id })),
    skus: active.map(s => ({ ...row(s.name, [s.id], periods.map(p => p.id)), skuId: s.id, weight: s.weight, packaging: s.packagingType ?? "New" }))
      .sort((a, b) => b.enteredFoc - a.enteredFoc),
    total,
  };
}
