// Helpers extracted from ForecastSplitPage for unit testing.

export const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
] as const;

export const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Build a list of up to N consecutive months starting from the given month/year. */
export function getConsecutiveMonths(
  startMonth: number,
  startYear: number,
  count: number,
): { month: number; year: number; label: string }[] {
  const months: { month: number; year: number; label: string }[] = [];
  let m = startMonth;
  let y = startYear;
  for (let i = 0; i < count; i++) {
    months.push({ month: m, year: y, label: `${MONTHS[m - 1].label} ${y}` });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}
