/** Quantities are MC. Shares and year-on-year changes never follow the unit toggle. */
export type Packaging = "Old" | "New";
export type PackagingMetric = "runRate" | "ims" | "forecast" | "production" | "arrival" | "stock" | "cover" | "selloutValue" | "stockValue";
export interface PackagingFigure {
  value: number; sharePct: number | null; lastYear: number | null; changePct: number | null;
}
export interface PackagingGroup {
  packaging: Packaging; skuCount: number;
  metrics: Record<PackagingMetric, PackagingFigure>;
  monthsToClear: number | null; projectedClearMonth: string | null;
  aggregateMonthsAtRate?: number | null;
}
export interface PackagingMonth {
  month: string; label: string;
  oldIms: number | null; newIms: number | null; oldSharePct: number | null; newSharePct: number | null;
}
export interface PackagingStock {
  ims: number; stock: number; runRate: number; coverWeeks: number | null; sharePct: number | null;
}
export interface PackagingPair {
  flavour: string; weight: string; old: PackagingStock; new: PackagingStock;
}
export interface PackagingStalled {
  skuId: number; sku: string; weight: string; stock: number; runRate: number; monthsToClear: number | null;
}
export interface PackagingExpiry {
  skuId: number; sku: string; weight: string; expiryDate: string; remainingMc: number; atRiskMc: number;
}
export interface PackagingAnalysis {
  /** Based on all active, included country SKUs, independently of header filters. */
  enabled: boolean; country: string; asOf: string; groups: PackagingGroup[]; hasPrices?: boolean;
  months: PackagingMonth[]; pairs: PackagingPair[]; stalled: PackagingStalled[]; expiry: PackagingExpiry[];
  notes: string[];
}
