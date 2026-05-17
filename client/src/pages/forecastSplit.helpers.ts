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

// ──────────────────────────────────────────────────────────────────────────
// Seasonal weighting for multi-month tonnage distribution.
//
// Forecasting best practice (Holt-Winters / classical decomposition / the
// way every demand-planning textbook treats the problem): the annual total
// is *level*, and each month is the level × a seasonal index × a trend
// factor. Splitting 1,000 tons equally across 6 months ignores the
// seasonality and trend — which is exactly what the user objected to.
//
// We encode three additive seasonal layers per country:
//   • Ramadan boost — the single biggest demand driver in MENA shisha
//     (night socializing after iftar, extended café hours, gifting). Hits
//     +35–40 % of base demand in the Ramadan month itself.
//   • Summer peak (Jun–Aug) — outdoor café season, tourism on the coast.
//   • Winter dip (Dec–Feb) — reduced outdoor activity, economic pressure.
// These match the per-month multipliers already baked into the per-SKU
// recommender in server/routers.ts, so the *total* now responds to the
// same factors that already drive the per-SKU split.
//
// Ramadan dates (Hijri, approx. Gregorian overlap) match the table in
// server/routers.ts.
// ──────────────────────────────────────────────────────────────────────────
const RAMADAN_MONTHS: Record<number, number[]> = {
  2024: [3, 4],
  2025: [3],
  2026: [2, 3],
  2027: [1, 2],
  2028: [1],
  2029: [1, 12],
  2030: [1, 12],
};

type SeasonalProfile = {
  ramadanBoostPct: number;   // e.g. 35 = +35%
  summerBoostPct: number;    // applied to Jun, Jul, Aug
  winterDipPct: number;      // applied to Dec, Jan, Feb (positive number, subtracted)
};

const COUNTRY_SEASONALITY: Record<string, SeasonalProfile> = {
  Lebanon: { ramadanBoostPct: 35, summerBoostPct: 22, winterDipPct: 12 },
  Syria:   { ramadanBoostPct: 35, summerBoostPct: 17, winterDipPct: 12 },
  Libya:   { ramadanBoostPct: 40, summerBoostPct: 17, winterDipPct: 7  },
  KSA:     { ramadanBoostPct: 35, summerBoostPct: 5,  winterDipPct: 0  },
};

/**
 * Return the seasonal multiplier (around 1.0) for a given country/month/year.
 * 1.0 = average month. 1.35 = Ramadan month in Lebanon (+35%).
 * Used to weight the tonnage allocation across a multi-month forecast.
 */
export function getSeasonalMultiplier(country: string, month: number, year: number): number {
  const profile = COUNTRY_SEASONALITY[country] ?? COUNTRY_SEASONALITY.Lebanon;
  let mult = 1;
  if ((RAMADAN_MONTHS[year] ?? []).includes(month)) {
    mult *= 1 + profile.ramadanBoostPct / 100;
  }
  if (month >= 6 && month <= 8) {
    mult *= 1 + profile.summerBoostPct / 100;
  }
  if (month === 12 || month === 1 || month === 2) {
    mult *= 1 - profile.winterDipPct / 100;
  }
  return mult;
}

/**
 * Distribute a TOTAL tonnage across N consecutive months using each month's
 * seasonal multiplier as its weight. The returned per-month tonnages sum to
 * `totalTons` exactly (modulo float precision).
 *
 * Example: 1,000 tons over Feb–Jul 2026 for Lebanon yields more tonnage in
 * Feb/Mar (Ramadan 2026) and Jun/Jul (summer peak) than in May.
 */
export function distributeTonsBySeasonality(
  totalTons: number,
  startMonth: number,
  startYear: number,
  count: number,
  country: string,
): { month: number; year: number; tons: number; multiplier: number }[] {
  const months = getConsecutiveMonths(startMonth, startYear, count);
  const weights = months.map(m => getSeasonalMultiplier(country, m.month, m.year));
  const totalWeight = weights.reduce((s, w) => s + w, 0) || count;
  return months.map((m, i) => ({
    month: m.month,
    year: m.year,
    tons: totalTons * weights[i] / totalWeight,
    multiplier: weights[i],
  }));
}
