import type { MonthlyAnalysis, MonthlyIndex, MonthlyRate, MonthlyRef, MonthlyRow, MonthlySuggestion } from "../../shared/performance/monthlyAnalysis";
import { classifyZone, coverRuleFor, weeksOfCoverAt } from "../../shared/performance/projection";
import { tabRunningRate } from "./countryPerformance.extra";
import {
  applyFilters, buildBatches, buildSkuSeries, flavourOf, isIntlCountry, latestActualImsIndex,
  monthIndexOf, num, parseYm, plannedArrivalsMap, resolveWindow, round, sortedPeriods, sum, totalWeeksAt, windowLabel,
  type PerformanceDataset, type SkuSeries,
} from "./countryPerformance.helpers";
import type { PerformanceRequest } from "./countryPerformance.types";
import { buildPackagingAnalysis } from "./packaging.helpers";
import { analysisSkuLabel, packagingOf } from "./countryPerformance.helpers";

export function monthlyRef(year: number, month: number): MonthlyRef {
  const date = new Date(Date.UTC(year, month - 1, 1));
  return {
    year: date.getUTCFullYear(), month: date.getUTCMonth() + 1,
    key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    label: date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }),
  };
}
type Observation = { month: MonthlyRef; value: number | null };
const percentage = (value: number, base: number) => base === 0 ? null : round((value - base) / base * 100, 1);
const mean = (values: number[]) => values.length ? sum(values) / values.length : 0;

/** The trusted rate method, including its positive-sales-only window and per-SKU rounding. */
export function monthlyRunningRate(history: Observation[]): MonthlyRate {
  const values = history.map(p => p.value ?? 0);
  const rate = tabRunningRate(values, values.length - 1);
  const last12 = values.slice(0, rate.lastIdx + 1).slice(-12).filter(v => v > 0);
  const trendPct = percentage(rate.avg3, rate.prior3);
  return {
    avg3: rate.avg3, avg6: rate.avg6, avg12: Math.round(mean(last12)), last: rate.last,
    lastMonth: rate.last > 0 ? history[rate.lastIdx]?.month.label ?? null : null,
    trendPct, direction: trendPct === null ? "No prior rate" : trendPct > 5 ? "Growing" : trendPct < -5 ? "Declining" : "Stable",
    sampleMonths: values.filter(v => v > 0).length,
  };
}

/** Observed zeros count; missing / auto-filled months do not masquerade as stable demand. */
export function monthlyVolatility(values: (number | null)[]): MonthlyRow["volatility"] {
  const observed = values.filter((v): v is number => v !== null);
  const average = mean(observed);
  const stdDev = Math.sqrt(mean(observed.map(v => (v - average) ** 2)));
  const cvPct = observed.length >= 3 && average > 0 ? round(stdDev / average * 100, 1) : null;
  return {
    months: observed.length, mean: round(average, 2), stdDev: round(stdDev, 2), cvPct,
    label: observed.length < 3 ? "Thin history" : average === 0 ? "No demand" : cvPct! <= 25 ? "Steady" : cvPct! <= 50 ? "Variable" : "Volatile",
  };
}

/** Calendar overlap, not a fixed Gregorian Ramadan month. Islamic civil dates are approximate. */
export function overlapsRamadan(year: number, month: number): boolean {
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-islamic-civil", { month: "numeric", timeZone: "UTC" });
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= days; day++) {
    if (Number(formatter.formatToParts(new Date(Date.UTC(year, month - 1, day))).find(p => p.type === "month")?.value) === 9) return true;
  }
  return false;
}

export function monthlySeasonality(history: Observation[]): MonthlyIndex[] {
  const observed = history.filter((p): p is { month: MonthlyRef; value: number } => p.value !== null);
  const baseline = mean(observed.map(p => p.value));
  return Array.from({ length: 12 }, (_, i) => {
    const points = observed.filter(p => p.month.month === i + 1);
    const years = [...new Set(points.map(p => p.month.year))];
    return {
      month: i + 1, index: points.length && baseline > 0 ? round(mean(points.map(p => p.value)) / baseline, 3) : null,
      years: years.length, ramadanYears: years.filter(y => overlapsRamadan(y, i + 1)), summer: i >= 5 && i <= 7,
    };
  });
}

/** Compare entered paid forecast, not FOC, against a run-rate × seasonal-index scenario. */
export function suggestedForecast(
  rate: number, months: MonthlyRef[], indexes: MonthlyIndex[], entered: (number | null)[],
  opening: number, supplyAndAdjustments: number[], country: string, thresholdPct = 20,
): MonthlySuggestion[] {
  const suggested = months.map(m => Math.round(rate * (indexes[m.month - 1]?.index ?? 1)));
  let suggestedClosing = opening;
  let currentClosing: number | null = opening;
  const rule = coverRuleFor(country);
  return months.slice(0, 6).map((month, i) => {
    const current = entered[i] ?? null;
    const differenceMc = current === null ? null : round(current - suggested[i], 2);
    suggestedClosing = round(suggestedClosing + (supplyAndAdjustments[i] ?? 0) - suggested[i], 2);
    currentClosing = currentClosing === null || current === null ? null : round(currentClosing + (supplyAndAdjustments[i] ?? 0) - current, 2);
    const canCalculateCover = rule.mode === "sameMonth" ? current !== null : entered[i + 1] != null && entered[i + 2] != null;
    return {
      month, suggested: suggested[i], current, differenceMc,
      differencePct: current === null ? null : percentage(current, suggested[i]),
      material: differenceMc !== null && Math.abs(differenceMc) >= Math.max(1, suggested[i] * thresholdPct / 100),
      availablePeriod: current !== null, currentClosing, suggestedClosing,
      currentCover: currentClosing === null || !canCalculateCover ? null : weeksOfCoverAt(currentClosing, entered.map(v => v ?? 0), i, rule),
      suggestedCover: weeksOfCoverAt(suggestedClosing, suggested, i, rule),
      seasonalityYears: indexes[month.month - 1]?.years ?? 0,
    };
  });
}

export function buildMonthlyAnalysis(ds: PerformanceDataset, req: PerformanceRequest): MonthlyAnalysis {
  const periods = sortedPeriods(ds);
  if (!periods.length) throw new Error(`No planning periods exist for ${req.country}`);
  const skus = applyFilters(ds.skus.filter(s => s.isActive !== false && !s.isExcludedFromTotal), req.filters);
  const allSeries = buildSkuSeries(ds, ds.skus);
  const ids = new Set(skus.map(s => s.id));
  const series = allSeries.filter(s => ids.has(s.sku.id));
  const ym = parseYm(req.anchor);
  const anchorIdx = ym ? monthIndexOf(periods, ym.year, ym.month) : -1;
  const w = resolveWindow(periods, req.preset, anchorIdx >= 0 ? anchorIdx : latestActualImsIndex(allSeries, periods, ds.now), req.from, req.to);
  const end = periods[w.toIdx];
  const first = periods[0];
  const startSerial = first.year * 12 + first.month;
  const endSerial = end.year * 12 + end.month;
  const historyMonths = Array.from({ length: endSerial - startSerial + 1 }, (_, i) => monthlyRef(first.year, first.month + i));
  const gridMonths = Array.from({ length: 24 }, (_, i) => monthlyRef(end.year, end.month - 23 + i));
  const selectedMonths = w.months.map(p => monthlyRef(p.year, p.month));
  // Two extra months supply Lebanon's next-two-month cover denominator.
  const futureMonths = Array.from({ length: 8 }, (_, i) => monthlyRef(end.year, end.month + 1 + i));
  const planned = plannedArrivalsMap(ds, skus, isIntlCountry(req.country) ? buildBatches(ds, skus) : []);
  const periodKeys = new Map(periods.map(p => [monthlyRef(p.year, p.month).key, p.id]));
  const actual = new Map<string, number>();
  for (const r of ds.ims) {
    const period = periods.find(p => p.id === r.periodId);
    if (period && r.source !== "auto_forecast" && period.year * 12 + period.month <= ds.now.getFullYear() * 12 + ds.now.getMonth() + 1) {
      actual.set(`${r.skuId}:${monthlyRef(period.year, period.month).key}`, num(r.value));
    }
  }
  const observations = (members: SkuSeries[], months: MonthlyRef[]): Observation[] => months.map(month => {
    const values = members.map(s => actual.get(`${s.sku.id}:${month.key}`)).filter((v): v is number => v !== undefined);
    return { month, value: values.length ? sum(values) : null };
  });
  const byWeight = [...new Set(skus.map(s => s.weight))];
  const countryHistory = observations(series, historyMonths);
  const countryIndexes = monthlySeasonality(countryHistory);
  const weightIndexes = new Map(byWeight.map(weight => [weight, monthlySeasonality(observations(series.filter(s => s.sku.weight === weight), historyMonths))]));
  const futureDemandByRow = new Map<string, number[]>();
  const makeRow = (members: SkuSeries[], identity: Pick<MonthlyRow, "id" | "sku" | "weight" | "category" | "flavour" | "total" | "packaging">): MonthlyRow => {
    const history = observations(members, historyMonths);
    const rates = members.map(s => monthlyRunningRate(observations([s], historyMonths)));
    const ownIndexes = monthlySeasonality(history);
    const indexes = ownIndexes.map((index, i) => index.index !== null ? index
      : weightIndexes.get(identity.weight)?.[i].index != null ? weightIndexes.get(identity.weight)![i] : countryIndexes[i]);
    futureDemandByRow.set(identity.id, futureMonths.map(month => Math.round(sum(rates.map(r => r.avg3)) * (indexes[month.month - 1].index ?? 1))));
    const lookup = new Map(history.map(p => [p.month.key, p.value]));
    const get = (year: number, month: number) => lookup.get(monthlyRef(year, month).key) ?? null;
    const closing = sum(members.map(s => s.months[w.toIdx].closing));
    const weeks = totalWeeksAt(members, w.toIdx, req.country);
    const prior3 = sum(members.map(s => tabRunningRate(observations([s], historyMonths).map(p => p.value ?? 0), historyMonths.length - 1).prior3));
    const avg3 = sum(rates.map(r => r.avg3));
    const trendPct = percentage(avg3, prior3);
    const comparison = selectedMonths.flatMap(month => {
      const value = lookup.get(month.key);
      if (value == null) return [];
      const idx = monthIndexOf(periods, month.year, month.month);
      const participating = members.filter(s => actual.has(`${s.sku.id}:${month.key}`));
      const forecast = sum(participating.map(s => s.months[idx].forecast));
      return [{ month, forecast, actual: value, gap: round(forecast - value, 2), gapPct: percentage(forecast, value) }];
    });
    const biasMonths = historyMonths.slice(-6).flatMap(month => {
      const idx = monthIndexOf(periods, month.year, month.month);
      return members.flatMap(s => {
        const value = actual.get(`${s.sku.id}:${month.key}`);
        return value === undefined ? [] : [{ actual: value, forecast: s.months[idx].forecast }];
      });
    });
    const biasPct = percentage(sum(biasMonths.map(p => p.forecast)), sum(biasMonths.map(p => p.actual)));
    const biasLabel = biasMonths.length < 3 ? "Thin history" : biasPct === null ? "No sales baseline"
      : biasMonths.every(p => p.forecast > p.actual) ? "Habitually over-forecast"
      : biasMonths.every(p => p.forecast < p.actual) ? "Habitually under-forecast" : "Mixed";
    const entered = futureMonths.map(month => {
      const idx = monthIndexOf(periods, month.year, month.month);
      return idx < 0 ? null : sum(members.map(s => s.months[idx].forecast));
    });
    const supply = futureMonths.map(month => {
      const idx = monthIndexOf(periods, month.year, month.month);
      if (idx < 0) return 0;
      return sum(members.map(s => {
        const c = s.months[idx], expected = (planned.get(`${s.sku.id}-${periodKeys.get(month.key)}`) ?? 0) + c.plannedArrivals;
        // Same actual/planned non-double-counting rule as the existing projection.
        return c.adjustments + (isIntlCountry(req.country) ? Math.max(c.arrivals, expected) : c.arrivals !== 0 ? c.arrivals : expected);
      }));
    });
    return {
      ...identity,
      rates: {
        avg3, avg6: sum(rates.map(r => r.avg6)), avg12: sum(rates.map(r => r.avg12)), last: sum(rates.map(r => r.last)),
        lastMonth: members.length === 1 ? rates[0].lastMonth : "Per-SKU latest", trendPct,
        direction: trendPct === null ? "No prior rate" : trendPct > 5 ? "Growing" : trendPct < -5 ? "Declining" : "Stable",
        sampleMonths: history.filter(p => p.value !== null && p.value > 0).length,
      },
      stock: { closing: round(closing, 2), weeks, zone: classifyZone(weeks, closing) },
      ims: observations(members, gridMonths).map(p => p.value), imsTotal: sum(observations(members, gridMonths).map(p => p.value ?? 0)),
      volatility: monthlyVolatility(history.slice(-24).map(p => p.value)),
      yoy: selectedMonths.map(month => {
        const current = get(month.year, month.month), prior = get(month.year - 1, month.month);
        const pairs = Array.from({ length: month.month }, (_, i) => [get(month.year, i + 1), get(month.year - 1, i + 1)])
          .filter((pair): pair is [number, number] => pair[0] !== null && pair[1] !== null);
        const cumulativeCurrent = pairs.length ? sum(pairs.map(p => p[0])) : null;
        const cumulativePrior = pairs.length ? sum(pairs.map(p => p[1])) : null;
        return { month, current, prior, growthPct: current === null || prior === null ? null : percentage(current, prior),
          cumulativeCurrent, cumulativePrior, cumulativeGrowthPct: cumulativeCurrent === null || cumulativePrior === null ? null : percentage(cumulativeCurrent, cumulativePrior) };
      }),
      comparison, bias: { months: biasMonths.length, gapPct: biasPct, label: biasLabel },
      suggestions: suggestedForecast(avg3, futureMonths, indexes, entered, closing, supply, req.country),
    };
  };
  const packaging = buildPackagingAnalysis(ds, w, series);
  const rows = series.map(s => makeRow([s], { id: String(s.sku.id), sku: analysisSkuLabel(s.sku), weight: s.sku.weight,
    category: s.sku.category ?? "Core", flavour: flavourOf(s.sku), packaging: packagingOf(s.sku), total: false }));
  const totals = [
    ...byWeight.map(weight => makeRow(series.filter(s => s.sku.weight === weight), { id: `weight:${weight}`, sku: `${weight} total`, weight, category: "", flavour: "", total: true })),
    ...(packaging.enabled ? packaging.groups.map(group => makeRow(series.filter(s => packagingOf(s.sku) === group.packaging), { id: `packaging:${group.packaging}`, sku: `${group.packaging} packaging`, weight: "", category: "", flavour: "", packaging: group.packaging, total: true })) : []),
    makeRow(series, { id: "country", sku: `${req.country} total`, weight: "", category: "", flavour: "", total: true }),
  ];
  // Group suggestions are sums of SKU-level suggestions, never a different group forecast model.
  for (const total of totals) {
    const children = rows.filter(row => total.id === "country" || (total.id.startsWith("packaging:") ? row.packaging === total.packaging : row.weight === total.weight));
    const suggestions = total.suggestions.map((s, i) => sum(children.map(row => row.suggestions[i].suggested)));
    const groupDemand = Array.from({ length: 8 }, (_, i) => sum(children.map(row => futureDemandByRow.get(row.id)![i])));
    total.suggestions = total.suggestions.map((s, i) => {
      const differenceMc = s.current === null ? null : round(s.current - suggestions[i], 2);
      const balance = sum(children.map(row => row.suggestions[i].suggestedClosing));
      return { ...s, suggested: suggestions[i], suggestedClosing: balance,
        suggestedCover: weeksOfCoverAt(balance, groupDemand, i, coverRuleFor(req.country)),
        differenceMc, differencePct: s.current === null ? null : percentage(s.current, suggestions[i]),
        material: differenceMc !== null && Math.abs(differenceMc) >= Math.max(1, suggestions[i] * .2) };
    });
  }
  return {
    packaging,
    country: req.country, asOf: end.label, windowLabel: windowLabel(w, req.preset), gridMonths, selectedMonths,
    forecastMonths: futureMonths.slice(0, 6), rows, totals,
    seasonality: [{ group: req.country, months: countryIndexes }, ...byWeight.map(weight => ({ group: weight, months: weightIndexes.get(weight)! })),
      ...(packaging.enabled ? packaging.groups.map(group => ({ group: `${group.packaging} packaging`, months: monthlySeasonality(observations(series.filter(s => packagingOf(s.sku) === group.packaging), historyMonths)) })) : [])],
    materialThresholdPct: 20,
    notes: [
      "Read-only suggestions. Nothing on this screen writes into the forecast.",
      "Rates use the existing Running Rate method: each SKU's last month with sales, positive-sales months in its 3/6/12-month windows, rounded per SKU. Totals add the SKU rates.",
      "Auto-filled IMS and future months are excluded from demand history and forecast-versus-actual. An empty cell means no recorded actual IMS; a recorded zero remains zero.",
      "The 24-month grid ends at the selected period. Year-on-year and forecast-versus-actual follow the selected period range; other metrics use history available through its end.",
      "Seasonality is calendar-month average IMS divided by average observed monthly IMS. 1.00 is average demand. Missing SKU indexes use weight, then country history, then 1.00. Thin history is not reliable.",
      "Ramadan overlaps use the approximate Islamic civil calendar and may differ from local moon sightings. Summer means June, July and August.",
      "Volatility is population standard deviation / average of recorded actual months over the last 24 months. At least 3 observations are required; <=25% is steady, <=50% variable, otherwise volatile.",
      "Year-on-year cumulative figures compare only months with actuals in both years. Forecast bias uses the last 6 months and requires at least 3 observed comparisons; a consistent gap is habitual.",
      "A forecast difference of at least 20% (minimum 1 MC) is material. Stock scenarios treat each forecast path as sell-out, keeping the same actual/planned receipts, adjustments and country cover rule. No new production or arrivals are assumed.",
      "Months outside the planning calendar have no entered forecast or known arrivals. Their suggestions assume zero new arrivals; entered-path stock and cover are unavailable. Null cover means the demand denominator is unavailable or zero.",
    ],
  };
}
