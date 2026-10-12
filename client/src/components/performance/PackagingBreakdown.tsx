import type { PackagingAnalysis, PackagingMetric } from "@shared/performance/packaging";
import { usePerfFormat } from "./shared";

const metricLabels: Record<PackagingMetric, string> = {
  runRate: "Run rate", ims: "IMS", forecast: "Forecast", production: "Production",
  arrival: "Arrivals", stock: "Stock", cover: "Cover", selloutValue: "Sell-out value", stockValue: "Stock value",
};
const metrics: PackagingMetric[] = ["runRate", "ims", "forecast", "production", "arrival", "stock", "cover", "selloutValue", "stockValue"];

export function packagingMetricsForPrices(hasPrices: boolean): PackagingMetric[] {
  return metrics.filter((metric) => hasPrices || (metric !== "selloutValue" && metric !== "stockValue"));
}

export function packagingCoverText(value: number, ownRunRate: number, formatWeeks: (v: number | null) => string) {
  return ownRunRate === 0 ? "Unknown" : formatWeeks(value);
}

export function hasPackagingBreakdown(data?: PackagingAnalysis | null) {
  return Boolean(data?.enabled && data.groups.length);
}

function figure(value: number | null, metric: PackagingMetric, fmtMc: (v: number | null) => string, fmtUsd: (v: number | null) => string, fmtWeeks: (v: number | null) => string) {
  if (metric === "cover") return fmtWeeks(value);
  if (metric === "selloutValue" || metric === "stockValue") return fmtUsd(value);
  return fmtMc(value);
}

/** A consistent view of the server-calculated Old/New split; values are never recalculated client-side. */
export default function PackagingBreakdown({ data, context, hasPrices: priceFallback = false }: { data?: PackagingAnalysis | null; context?: string; hasPrices?: boolean }) {
  const { fmtMc, fmtUsd, fmtWeeks, fmtPct, fmtPctSigned, unitLabel } = usePerfFormat();
  if (!hasPackagingBreakdown(data)) return null;
  const hasPrices = (data as PackagingAnalysis & { hasPrices?: boolean }).hasPrices ?? priceFallback;
  const byContext: Record<string, PackagingMetric[]> = {
    runningRate: ["runRate"], outlook: ["ims", "forecast", "runRate"], demand: ["ims", "forecast"],
    flow: ["forecast", "production", "arrival", "ims"], supply: ["production", "arrival"],
    stockSituation: ["production", "arrival", "stock"], inventory: ["stock", "cover"],
    quality: ["ims", "forecast"], portfolio: ["ims", "stock"], forward: ["forecast", "stock", "cover"],
    commercial: ["selloutValue", "stockValue"],
  };
  const visibleMetrics = packagingMetricsForPrices(hasPrices).filter(metric => !context || !byContext[context] || byContext[context].includes(metric));
  if (!visibleMetrics.length) return null;
  const unclearClearout = data!.groups.some((group) => group.metrics.stock.value > 0 && group.metrics.runRate.value > 0 && group.monthsToClear == null);
  return <section aria-label={`Packaging breakdown${context ? ` · ${context}` : ""}`} className="overflow-hidden rounded-lg border border-[#8c552f]/25 bg-[#fcf8f1]">
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#8c552f]/20 px-4 py-3">
      <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#80502f]">Packaging split</p><h3 className="mt-0.5 text-sm font-bold">Old versus New</h3></div>
      <p className="text-xs text-muted-foreground">Active country SKUs · current analysis filters · {data!.asOf || "date not recorded"} · {unitLabel}{hasPrices ? " and USD" : ""}</p>
    </div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1100px] border-collapse text-xs">
        <thead><tr className="bg-[#f3e9d9] text-left text-[10px] uppercase tracking-wide text-[#68452e]">
          <th className="sticky left-0 z-20 min-w-32 bg-[#f3e9d9] px-3 py-2">Packaging</th>
          <th className="px-3 py-2 text-right">SKUs</th>
          {visibleMetrics.map((metric) => <th key={metric} colSpan={4} className="border-l border-[#8c552f]/15 px-2 py-2 text-center">{metricLabels[metric]}</th>)}
          <th className="border-l border-[#8c552f]/15 px-3 py-2 text-right">Months to complete clear-out</th>
          <th className="px-3 py-2">Projected clear-out</th>
        </tr><tr className="bg-[#f8f1e7] text-[10px] text-muted-foreground">
          <th className="sticky left-0 z-20 bg-[#f8f1e7] px-3 py-1">Current</th><th />
          {visibleMetrics.flatMap((metric) => ["Value", metric === "cover" ? "Stock share" : "Share", "Last year", "Growth"].map((label) => <th key={`${metric}-${label}`} className="border-l border-[#8c552f]/10 px-2 py-1 text-right">{label}</th>))}
          <th /><th />
        </tr></thead>
        <tbody>{data!.groups.map((group) => <tr key={group.packaging} className="border-t border-[#8c552f]/10 odd:bg-white/60">
          <th scope="row" className={`sticky left-0 z-[1] px-3 py-2 text-left font-bold ${group.packaging === "Old" ? "bg-[#f8ead8] text-[#80502f]" : "bg-[#e8f0ed] text-[#315b51]"}`}>{group.packaging}</th>
          <td className="px-3 py-2 text-right tabular-nums">{group.skuCount.toLocaleString("en-US")}</td>
          {visibleMetrics.flatMap((metric) => {
            const item = group.metrics[metric];
            const displayValue = metric === "cover" ? packagingCoverText(item.value, group.metrics.runRate.value, fmtWeeks) : figure(item.value, metric, fmtMc, fmtUsd, fmtWeeks);
            const lastYearDisplay = metric === "cover" ? packagingCoverText(item.lastYear ?? 0, group.metrics.runRate.lastYear ?? 0, fmtWeeks) : figure(item.lastYear, metric, fmtMc, fmtUsd, fmtWeeks);
            return [
              <td key={`${metric}-value`} className="border-l border-[#8c552f]/10 px-2 py-2 text-right tabular-nums">{displayValue}</td>,
              <td key={`${metric}-share`} className="px-2 py-2 text-right tabular-nums">{fmtPct(item.sharePct)}</td>,
              <td key={`${metric}-ly`} className="px-2 py-2 text-right tabular-nums">{lastYearDisplay}</td>,
              <td key={`${metric}-growth`} className={`px-2 py-2 text-right tabular-nums ${item.changePct == null ? "text-muted-foreground" : item.changePct >= 0 ? "text-emerald-800" : "text-rose-800"}`}>{fmtPctSigned(item.changePct)}</td>,
            ];
          })}
          <td className="border-l border-[#8c552f]/10 px-3 py-2 text-right tabular-nums">{group.monthsToClear == null ? "—" : group.monthsToClear.toFixed(1)}</td>
          <td className="px-3 py-2">{group.projectedClearMonth ?? "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {unclearClearout && <p className="border-t border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-950">Clear-out timing is incomplete: at least one positive-stock group has demand overall but includes stock with no demand. A missing clear-out date is not a zero-rate estimate.</p>}
    {!!data!.notes.length && <p className="border-t border-[#8c552f]/15 px-4 py-2 text-xs text-muted-foreground">{data!.notes.join(" ")}</p>}
  </section>;
}
