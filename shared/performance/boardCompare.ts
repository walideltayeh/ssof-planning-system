/**
 * "What changed since the last board" — pure comparison of two frozen board
 * headlines. Shared by the server (Excel export) and the client page.
 */
import type { BoardHeadline } from "../../server/analysis/countryPerformance.types";

export interface HeadlineChange {
  key: string;
  label: string;
  unit: "MC" | "weeks" | "pct" | "count";
  before: number | null;
  after: number | null;
  delta: number | null;
  pct: number | null;
  /** true when a larger number is better (sales), false when smaller is better (risk counts). */
  higherIsBetter: boolean | null;
}

export interface ForecastRevision {
  sku: string;
  weight: string;
  before: number;
  after: number;
  delta: number;
  pct: number | null;
}

export interface BoardComparison {
  changes: HeadlineChange[];
  risksAdded: BoardHeadline["risks"];
  risksResolved: BoardHeadline["risks"];
  forecastRevisions: ForecastRevision[];
  totalForecastRevisionMc: number;
  sameYear: boolean;
  summary: string;
}

const round = (v: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(v * f) / f;
};
const pctOf = (after: number | null, before: number | null) => (after === null || before === null || before === 0 ? null : round(((after - before) / Math.abs(before)) * 100, 1));
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

export function compareHeadlines(current: BoardHeadline, previous: BoardHeadline): BoardComparison {
  const change = (key: string, label: string, unit: HeadlineChange["unit"], after: number | null, before: number | null, higherIsBetter: boolean | null): HeadlineChange => ({
    key,
    label,
    unit,
    before,
    after,
    delta: after === null || before === null ? null : round(after - before, unit === "weeks" || unit === "pct" ? 1 : 0),
    pct: unit === "MC" ? pctOf(after, before) : null,
    higherIsBetter,
  });
  const changes: HeadlineChange[] = [
    change("ytdIms", "Year-to-date sell-out (IMS)", "MC", current.ytdIms, previous.ytdIms, true),
    change("landing", "Full-year landing estimate", "MC", current.landing, previous.landing, true),
    change("remainingForecast", "Remaining forecast", "MC", current.remainingForecast, previous.remainingForecast, null),
    change("annualPlan", "Annual plan", "MC", current.annualPlan, previous.annualPlan, null),
    change("runningRate", "Running rate (latest month)", "MC", current.runningRate, previous.runningRate, true),
    change("closingStock", "Closing stock", "MC", current.closingStock, previous.closingStock, null),
    change("weeksOfCover", "Weeks of cover", "weeks", current.weeksOfCover, previous.weeksOfCover, null),
    change("forecastAccuracyPct", "Forecast accuracy", "pct", current.forecastAccuracyPct, previous.forecastAccuracyPct, true),
    change("stockoutRiskSkus", "SKUs at stock-out risk", "count", current.stockoutRiskSkus, previous.stockoutRiskSkus, false),
    change("overstockSkus", "Overstocked SKUs", "count", current.overstockSkus, previous.overstockSkus, false),
  ];

  const riskKey = (r: BoardHeadline["risks"][number]) => `${r.sku}|${r.issue}`;
  const prevKeys = new Set(previous.risks.map(riskKey));
  const curKeys = new Set(current.risks.map(riskKey));
  const risksAdded = current.risks.filter((r) => !prevKeys.has(riskKey(r)));
  const risksResolved = previous.risks.filter((r) => !curKeys.has(riskKey(r)));

  const sameYear = current.year === previous.year;
  const prevForecast = new Map(previous.skuForecasts.map((f) => [`${f.sku}|${f.weight}`, f.remainingForecast]));
  const forecastRevisions: ForecastRevision[] = sameYear
    ? current.skuForecasts
        .map((f) => {
          const before = prevForecast.get(`${f.sku}|${f.weight}`);
          if (before === undefined) return null;
          const delta = round(f.remainingForecast - before);
          return { sku: f.sku, weight: f.weight, before, after: f.remainingForecast, delta, pct: pctOf(f.remainingForecast, before) };
        })
        .filter((x): x is ForecastRevision => x !== null && x.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    : [];
  const totalForecastRevisionMc = round(forecastRevisions.reduce((s, r) => s + r.delta, 0));

  const parts: string[] = [];
  const landing = changes.find((c) => c.key === "landing");
  if (landing && landing.delta !== null && landing.delta !== 0) parts.push(`landing estimate ${landing.delta > 0 ? "up" : "down"} ${fmt(Math.abs(landing.delta))} MC`);
  const rate = changes.find((c) => c.key === "runningRate");
  if (rate && rate.delta !== null && rate.delta !== 0) parts.push(`running rate ${rate.delta > 0 ? "up" : "down"} ${fmt(Math.abs(rate.delta))} MC/month`);
  if (risksAdded.length) parts.push(`${risksAdded.length} new risk${risksAdded.length === 1 ? "" : "s"}`);
  if (risksResolved.length) parts.push(`${risksResolved.length} risk${risksResolved.length === 1 ? "" : "s"} resolved`);
  if (forecastRevisions.length) parts.push(`forecast revised on ${forecastRevisions.length} SKU${forecastRevisions.length === 1 ? "" : "s"} (net ${totalForecastRevisionMc >= 0 ? "+" : "−"}${fmt(Math.abs(totalForecastRevisionMc))} MC)`);
  const summary = parts.length ? `Since the last board pack: ${parts.join(", ")}.` : "No material change in the headline numbers since the last board pack.";
  if (!sameYear) parts.push("different planning year — forecast revisions not compared");

  return { changes, risksAdded, risksResolved, forecastRevisions, totalForecastRevisionMc, sameYear, summary };
}
