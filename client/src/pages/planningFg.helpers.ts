// ── Excel-matching conditional formatting for the Planning FG grid ──────────
// Extracted from PlanningFgPage so it can be unit-tested independently.

export function getWeeksStyle(weeks: number): string {
  if (!isFinite(weeks) && weeks > 0) return "bg-purple-200 text-purple-900 font-bold";
  if (!isFinite(weeks) && weeks < 0) return "bg-gray-900 text-white font-bold";
  if (weeks === 0)   return "bg-gray-200 text-gray-500 font-bold";
  if (weeks < 0)     return "bg-gray-900 text-white font-bold";
  if (weeks < 4)     return "bg-red-600 text-white font-bold";
  if (weeks <= 6)    return "text-emerald-700 font-bold";
  return "bg-red-600 text-white font-bold";
}

export function getClosingStockStyle(val: number): string {
  if (val < 0) return "bg-red-100 text-red-800 font-bold";
  return "";
}
