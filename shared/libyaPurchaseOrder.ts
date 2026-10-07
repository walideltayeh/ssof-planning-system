export const LIBYA_PO_REFERENCE = "E.SA.FO.111.C001232 / CR-26-037";
export const LIBYA_PO_MONTHS = [9, 10, 11, 12] as const;
export const LIBYA_PO = [
  { name: "Double Apple", weight: "50g", ordered: [2740.79, 3765.17, 5160.40, 7001.83], foc: [287.20, 387.65, 527.14, 711.31] },
  { name: "Mint", weight: "50g", ordered: [12532.89, 17217.10, 23597.11, 32017.44], foc: [1313.30, 1772.60, 2410.45, 3252.61] },
  { name: "Double Apple", weight: "1kg", ordered: [548.16, 753.03, 1032.08, 1400.37], foc: [57.44, 77.53, 105.43, 142.26] },
  { name: "Mint", weight: "1kg", ordered: [548.16, 753.03, 1032.08, 1400.37], foc: [57.44, 77.53, 105.43, 142.26] },
] as const;
export const LIBYA_PO_SPLIT = [
  { month: "Sep 2026", domestic: 11666.67, export: 4703.33 },
  { month: "Oct 2026", domestic: 18500, export: 3988.33 },
  { month: "Nov 2026", domestic: 26833.33, export: 3988.33 },
  { month: "Dec 2026", domestic: 37833.33, export: 3986.67 },
];
export const LIBYA_PO_ROUNDING_NOTE = "Exact SKU figures approved by the user: ordered December 41,820.01 and grand total 111,500.01 MC (each +0.01 versus the PO checks). FOC September 1,715.38 (-0.01), November 3,148.45 (+0.01), grand total 11,427.58 MC. Domestic + Export November is 30,821.66 MC versus SKU total 30,821.67; split grand total 111,499.99 versus SKU total 111,500.01. No SKU was adjusted to force a tie. Quantities were supplied in MC; no KG conversion.";
export function matchLibyaPo(
  skus: { id: number; country: string; name: string; weight: string; packagingType: string | null; isActive: boolean }[],
  periods: { id: number; country: string; year: number; month: number; label: string }[],
) {
  return LIBYA_PO.flatMap(line => {
    const matches = skus.filter(s => s.country === "Libya" && s.isActive && s.name === line.name && s.weight === line.weight && s.packagingType === "New");
    if (matches.length !== 1) throw new Error(`Cannot uniquely match active Libya SKU: ${line.name} ${line.weight} New. No SKU was created or guessed.`);
    return LIBYA_PO_MONTHS.map((month, i) => {
      const ps = periods.filter(p => p.country === "Libya" && p.year === 2026 && p.month === month);
      if (ps.length !== 1) throw new Error(`Cannot uniquely match Libya period: 2026-${month}.`);
      return { skuId: matches[0].id, periodId: ps[0].id, sku: `${line.name} ${line.weight} New`, month: ps[0].label, ordered: line.ordered[i], foc: line.foc[i] };
    });
  });
}
