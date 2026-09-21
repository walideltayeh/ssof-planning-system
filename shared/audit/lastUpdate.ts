/**
 * "Last update" helpers shared by the server query and the client strip.
 *
 * An audit entry counts as a data update when it changed planning data —
 * page views, sign-ins, exports and user-account admin do not.
 */

/** Actions that never change planning data. */
export const NON_DATA_ACTIONS = ["page_view", "login", "login_failed", "logout", "export_excel", "export_pdf"] as const;

/** Sheets whose audit entries are about accounts, not planning data. */
export const NON_DATA_SHEETS = ["Users"] as const;

export function isDataUpdate(action: string, sheet: string | null | undefined): boolean {
  if ((NON_DATA_ACTIONS as readonly string[]).includes(action)) return false;
  if (action.startsWith("export_")) return false;
  if (sheet && (NON_DATA_SHEETS as readonly string[]).includes(sheet)) return false;
  return true;
}

const ACTION_LABELS: Record<string, string> = {
  upload: "Upload",
  import: "Import",
  import_version: "Version imported",
  save_version: "Version saved",
  load_version: "Version loaded",
  delete_version: "Version deleted",
  edit: "Edit",
  edit_cell: "Cell edit",
  zero: "Cleared to zero",
  auto_fill: "Auto-fill",
  apply_recommendation: "Recommendation applied",
  rollback_recommendation: "Recommendation rolled back",
  add_sku: "SKU added",
  create_sku: "SKU added",
  update_sku: "SKU updated",
  delete_sku: "SKU deleted",
  reorder_sku: "SKUs reordered",
  change_category: "Category changed",
  toggle_exclusion: "Exclusion toggled",
  add_year: "Year added",
  add: "Added",
  freeze_board_pack: "Board pack frozen",
};

/** Plain-English description of an audit entry, e.g. "Upload — IMS Actuals". */
export function describeUpdate(action: string, sheet: string | null | undefined): string {
  const label = ACTION_LABELS[action] ?? action.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return sheet ? `${label} — ${sheet}` : label;
}

/** "just now", "3 hours ago", "5 days ago" — relative to `now`, in whole units. */
export function relativeTime(at: Date | string, now: Date = new Date()): string {
  const then = at instanceof Date ? at : new Date(at);
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30.4);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365.25);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

export interface CountryLastUpdate {
  country: string;
  /** null when no data change has been recorded for the country. */
  at: string | null;
  username: string | null;
  displayName: string | null;
  action: string | null;
  sheet: string | null;
  details: string | null;
}
