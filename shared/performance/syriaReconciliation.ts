/** All quantities and signed contributions are stored in mastercases.
 * Differences are always WS Tracker minus SSOF. Unknown is never zero.
 */
export type ReconciliationCause =
  | "uncleared" | "dated" | "opening" | "adjustments" | "unmapped"
  | "outside" | "inactive" | "excluded" | "ssofOnly" | "unexplained";
export interface ReconciliationDetail {
  sku: string;
  skuId?: number;
  month: string;
  trackerMonth?: string;
  ssofMonth?: string;
  mc: number;
  note: string;
}
export interface ReconciliationBreakdown {
  cause: ReconciliationCause;
  label: string;
  mc: number | null;
  note: string;
  details: ReconciliationDetail[];
}
export interface SyriaReconciliationLine {
  id: "ims" | "arrivals" | "warehouse";
  label: string;
  tracker: number | null;
  ssof: number | null;
  difference: number | null;
  ties: boolean | null;
  breakdown: ReconciliationBreakdown[];
  missing: string[];
}
export interface SyriaReconciliation {
  status: "available" | "unavailable";
  error?: string;
  from: string;
  to: string;
  generatedAt: string | null;
  checkedAt: string;
  scope: string;
  lines: SyriaReconciliationLine[];
  mappedIms: { tracker: number; ssof: number; ties: boolean } | null;
  conclusion: string;
  warning: boolean;
  pendingProduction: ReconciliationDetail[];
  ignoredOpeningEntries: ReconciliationDetail[];
  chainStart: string | null;
}
