import { mcPrecision, type FocCell } from "./performance/foc";
import { receivedFocMC } from "./focEntry";

/** Syria Received FOC is available to clear, not already in warehouse stock. */
export function arrivalFocMap(country: string, cells: FocCell[] = []): Map<string, number> {
  const result = new Map<string, number>();
  // This change is deliberately Syria-only; other countries keep their basis.
  if (country !== "Syria") return result;
  for (const cell of cells) {
    if (cell.country != null && cell.country !== country) continue;
    if (cell.value == null) continue;
    const quantity = receivedFocMC(cell);
    if (Number.isFinite(quantity) && quantity > 0)
      result.set(`${cell.skuId}-${cell.periodId}`, mcPrecision(quantity));
  }
  return result;
}

export function combinedArrivalQuantities(plannedProduction: number, actualProduction: number, foc: number) {
  const plannedTotal = mcPrecision(plannedProduction + foc);
  // Received FOC-only batches are available to clear without fabricating paid
  // actual production. A paid forecast still awaits its own production entry.
  const actualTotal = actualProduction > 0 ? mcPrecision(actualProduction + foc) : plannedProduction === 0 ? foc : 0;
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

/** Syria FG and Arrival share the same production priority: manual actual,
 * entered shipment weeks, then forecast. Other countries retain their FG basis.
 * The physical quantity is separate from warehouse stock and paid-only editing. */
export function fgProductionMap(
  country: string,
  forecast: { skuId: number; periodId: number; value?: string | number | null }[],
  actual: { skuId: number; periodId: number; value?: string | number | null }[] = [],
  foc: FocCell[] = [],
  shipment: { skuId: number; periodId: number; week1?: string | number | null; week2?: string | number | null; week3?: string | number | null; week4?: string | number | null }[] = [],
) {
  const production = new Map(forecast.map(row => [`${row.skuId}-${row.periodId}`, Number(row.value) || 0]));
  if (country === "Syria") for (const row of shipment) {
    const quantity = [row.week1, row.week2, row.week3, row.week4].reduce<number>((sum, value) => sum + (Number(value) || 0), 0);
    if (quantity > 0) production.set(`${row.skuId}-${row.periodId}`, mcPrecision(quantity));
  }
  for (const row of actual) if (Number(row.value) > 0) production.set(`${row.skuId}-${row.periodId}`, Number(row.value));
  for (const [key, quantity] of arrivalFocMap(country, foc)) production.set(key, mcPrecision((production.get(key) ?? 0) + quantity));
  return production;
}
