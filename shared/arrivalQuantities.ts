import { mcPrecision, type FocCell } from "./performance/foc";

/** Physical expected quantities, independent of the warehouse Received switch. */
export function arrivalFocMap(country: string, cells: FocCell[] = []): Map<string, number> {
  const result = new Map<string, number>();
  // This change is deliberately Syria-only; other countries keep their basis.
  if (country !== "Syria") return result;
  for (const cell of cells) {
    if (cell.country != null && cell.country !== country) continue;
    const quantity = Number(cell.value);
    if (Number.isFinite(quantity) && quantity > 0)
      result.set(`${cell.skuId}-${cell.periodId}`, mcPrecision(quantity));
  }
  return result;
}

export function combinedArrivalQuantities(plannedProduction: number, actualProduction: number, foc: number) {
  const plannedTotal = mcPrecision(plannedProduction + foc);
  // Do not fabricate paid actuals for a forecast-only or FOC-only batch.
  const actualTotal = actualProduction > 0 ? mcPrecision(actualProduction + foc) : 0;
  const productionTotal = actualProduction > 0 ? actualProduction : plannedProduction;
  return {
    plannedTotal, actualTotal, productionTotal, focTotal: foc,
    total: mcPrecision(productionTotal + foc),
  };
}

/** Paid production can be cleared while the additional FOC still awaits clearance. */
export function arrivalStatusWithFoc(status: string, foc: number, total: number, cleared: number): string {
  return foc > 0 && status === "Cleared" && cleared > 0 && cleared < total ? "Partially Cleared" : status;
}
