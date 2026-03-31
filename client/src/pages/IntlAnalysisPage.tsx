import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TableSkeleton } from "@/components/TableSkeleton";

// ==================== SHARED HELPERS ====================

const PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];
const WEIGHT_COLOR: Record<string, string> = { "1kg": "#ef4444", "250g": "#f59e0b", "50g": "#3b82f6" };
const STATUS_COLOR: Record<string, string> = {
  "Cleared": "#10b981", "Partially Cleared": "#14b8a6", "Arrived": "#f59e0b",
  "In Transit": "#3b82f6", "Pending": "#9ca3af", "Delayed": "#ef4444",
};

function fmt(n: number) { return n.toLocaleString("en-US"); }

function PackagingBadge({ type }: { type?: string }) {
  const isOld = type === "Old";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
      isOld ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-sky-50 text-sky-700 border-sky-200"
    }`}>{isOld ? "Old Pkg" : "New Pkg"}</span>
  );
}

function WeightBadge({ weight }: { weight: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
      weight === "50g" ? "bg-blue-100 text-blue-700" :
      weight === "250g" ? "bg-amber-100 text-amber-700" :
      "bg-rose-100 text-rose-700"
    }`}>{weight}</span>
  );
}

function KpiCard({ title, value, subtitle, color, trend }: { title: string; value: string; subtitle?: string; color: string; trend?: number | null }) {
  return (
    <Card className="relative overflow-hidden">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: color }} />
      <CardContent className="p-4 pl-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
        <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        {trend !== null && trend !== undefined && (
          <p className={`text-xs font-semibold mt-1 ${trend >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {trend >= 0 ? "+" : ""}{trend}% vs prior period
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function MiniBar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      {label && <span className="text-xs text-muted-foreground min-w-[50px] text-right">{label}</span>}
    </div>
  );
}

function SparkLine({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 200;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - ((v - min) / range) * (height - 4)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <polyline fill="none" stroke={color} strokeWidth="2" points={points} strokeLinecap="round" strokeLinejoin="round" />
      <polyline fill={`${color}20`} stroke="none" points={`0,${height} ${points} ${w},${height}`} />
    </svg>
  );
}

function DonutChart({ segments, size = 120, formatter }: { segments: { label: string; value: number; color: string }[]; size?: number; formatter?: (n: number) => string }) {
  const f = formatter ?? fmt;
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <div className="text-xs text-muted-foreground">No data</div>;
  const radius = size / 2 - 10;
  const innerRadius = radius * 0.6;
  let startAngle = -90;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {segments.map((seg, idx) => {
          const angle = (seg.value / total) * 360;
          const endAngle = startAngle + angle;
          const largeArc = angle > 180 ? 1 : 0;
          const cx = size / 2, cy = size / 2;
          const x1 = cx + radius * Math.cos((startAngle * Math.PI) / 180);
          const y1 = cy + radius * Math.sin((startAngle * Math.PI) / 180);
          const x2 = cx + radius * Math.cos((endAngle * Math.PI) / 180);
          const y2 = cy + radius * Math.sin((endAngle * Math.PI) / 180);
          const ix1 = cx + innerRadius * Math.cos((startAngle * Math.PI) / 180);
          const iy1 = cy + innerRadius * Math.sin((startAngle * Math.PI) / 180);
          const ix2 = cx + innerRadius * Math.cos((endAngle * Math.PI) / 180);
          const iy2 = cy + innerRadius * Math.sin((endAngle * Math.PI) / 180);
          const d = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
          startAngle = endAngle;
          return <path key={idx} d={d} fill={seg.color} stroke="white" strokeWidth="1.5" />;
        })}
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fontSize="11" fontWeight="bold" fill="currentColor">{f(total)}</text>
        <text x={size / 2} y={size / 2 + 12} textAnchor="middle" fontSize="8" fill="#9ca3af">Total</text>
      </svg>
      <div className="space-y-1">
        {segments.map((seg, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: seg.color }} />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-semibold ml-auto">{Math.round((seg.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StackedBarChart({ data, keys, colors, labels, formatter }: {
  data: { label: string; values: Record<string, number> }[];
  keys: string[];
  colors: Record<string, string>;
  labels: Record<string, string>;
  formatter?: (n: number) => string;
}) {
  const f = formatter ?? fmt;
  const maxTotal = Math.max(...data.map((d) => keys.reduce((s, k) => s + (d.values[k] || 0), 0)), 1);
  return (
    <div className="space-y-1">
      <div className="flex gap-3 mb-2">
        {keys.map((k) => (
          <div key={k} className="flex items-center gap-1 text-[10px]">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[k] }} />
            <span className="text-muted-foreground">{labels[k]}</span>
          </div>
        ))}
      </div>
      {data.map((d) => {
        const total = keys.reduce((s, k) => s + (d.values[k] || 0), 0);
        return (
          <div key={d.label} className="flex items-center gap-2">
            <div className="min-w-[60px] text-[10px] text-muted-foreground text-right truncate">{d.label}</div>
            <div className="flex-1 h-4 bg-muted rounded overflow-hidden flex">
              {keys.map((k) => {
                const pct = maxTotal > 0 ? ((d.values[k] || 0) / maxTotal) * 100 : 0;
                return pct > 0 ? (
                  <div key={k} className="h-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: colors[k] }} />
                ) : null;
              })}
            </div>
            <span className="text-[10px] text-muted-foreground min-w-[40px] text-right">{f(total)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ==================== MAIN PAGE ====================

export default function IntlAnalysisPage() {
  const { country } = useCountry();
  const { formatVal, unitLabel } = useUnit();
  const fmt = (n: number) => formatVal(n);
  const [activeTab, setActiveTab] = useState("production");

  const { data, isLoading } = trpc.country.intlAnalysis.useQuery(
    { country: country as "Syria" | "Libya" },
    { enabled: country === "Syria" || country === "Libya" }
  );
  const { data: runningRateData, isLoading: loadingRunRate } = trpc.country.runningRate.useQuery(
    { country: country as "Lebanon" | "Syria" | "Libya" },
    { enabled: country === "Syria" || country === "Libya" }
  );
  const { data: stockLevelsData, isLoading: loadingStockLvl } = trpc.country.stockLevels.useQuery(
    { country: country as "Lebanon" | "Syria" | "Libya" },
    { enabled: country === "Syria" || country === "Libya" }
  );

  if (country !== "Syria" && country !== "Libya") {
    return <div className="p-6 text-muted-foreground">This page is only available for Syria and Libya.</div>;
  }

  if (isLoading || !data) {
    return <div className="p-6"><TableSkeleton rows={8} cols={6} title="Loading analysis data..." /></div>;
  }

  const {
    totalSkus,
    totalProduction,
    totalCleared,
    totalPending,
    clearanceRate,
    batchesWithDelay,
    statusCounts,
    monthlyProductionSeries,
    monthlyImsSeries,
    monthlyForecastSeries,
    monthlyRevisedForecastSeries,
    periodLabels,
    skuProductionBreakdown,
    weightBreakdown,
    packagingBreakdown,
    clearanceBatches,
    forecastAccuracyByPeriod,
    overallForecastAccuracy,
    imsGrowthRate,
    topSkusByIms,
    flavourBreakdown,
  } = data as any;

  const shortLabels = (periodLabels as string[]).map((l: string) => l.slice(0, 3) + "'" + l.slice(-2));
  const totalIms = (monthlyImsSeries as number[]).reduce((a: number, b: number) => a + b, 0);

  // ==================== PRODUCTION TAB ====================
  const ProductionTab = () => {
    const [sortBy, setSortBy] = useState<"production" | "ims">("production");

    const sorted = useMemo(() =>
      [...(skuProductionBreakdown as any[])].sort((a, b) =>
        sortBy === "production" ? b.totalProduction - a.totalProduction : b.totalIms - a.totalIms
      ), [sortBy]);

    const maxProd = Math.max(...(skuProductionBreakdown as any[]).map((s: any) => s.totalProduction), 1);

    return (
      <div className="space-y-6">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Total SKUs" value={String(totalSkus)} color="#3b82f6" />
          <KpiCard title="Total Production" value={fmt(totalProduction)} subtitle="All periods" color="#f59e0b" />
          <KpiCard title="Total IMS" value={fmt(totalIms)} subtitle="All periods" color="#10b981" trend={imsGrowthRate} />
          <KpiCard title="Prod vs IMS Gap" value={fmt(totalProduction - totalIms)} subtitle="Production − IMS" color={totalProduction >= totalIms ? "#f59e0b" : "#ef4444"} />
        </div>

        {/* Monthly trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Production vs IMS vs Forecast</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Production Trend</p>
                <SparkLine data={monthlyProductionSeries} color="#f59e0b" height={50} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1">IMS Trend</p>
                <SparkLine data={monthlyImsSeries} color="#10b981" height={50} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Forecast Trend</p>
                <SparkLine data={monthlyForecastSeries ?? []} color="#8b5cf6" height={50} />
              </div>
            </div>
            <StackedBarChart
              data={shortLabels.map((lbl: string, i: number) => ({
                label: lbl,
                values: {
                  production: (monthlyProductionSeries as number[])[i] ?? 0,
                  ims: (monthlyImsSeries as number[])[i] ?? 0,
                  forecast: ((monthlyForecastSeries as number[]) ?? [])[i] ?? 0,
                },
              }))}
              keys={["production", "ims", "forecast"]}
              colors={{ production: "#f59e0b", ims: "#10b981", forecast: "#8b5cf6" }}
              labels={{ production: "Production", ims: "IMS", forecast: "Forecast" }}
              formatter={fmt}
            />
          </CardContent>
        </Card>

        {/* Weight + Packaging breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Production by Weight</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={(weightBreakdown as any[])
                  .filter((w: any) => w.totalProduction > 0)
                  .map((w: any) => ({ label: `${w.weight} (${w.skuCount} SKUs)`, value: w.totalProduction, color: WEIGHT_COLOR[w.weight] ?? "#6b7280" }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">IMS by Weight</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={(weightBreakdown as any[])
                  .filter((w: any) => w.totalIms > 0)
                  .map((w: any) => ({ label: w.weight, value: w.totalIms, color: WEIGHT_COLOR[w.weight] ?? "#6b7280" }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Production by Packaging</CardTitle></CardHeader>
            <CardContent>
              {packagingBreakdown && (packagingBreakdown as any[]).length > 0 ? (
                <DonutChart
                  segments={(packagingBreakdown as any[]).map((p: any) => ({
                    label: `${p.packagingType} Packaging (${p.skuCount} SKUs)`,
                    value: p.totalProduction,
                    color: p.packagingType === "Old" ? "#f59e0b" : "#3b82f6",
                  }))}
                  formatter={fmt}
                />
              ) : (
                <p className="text-xs text-muted-foreground">No packaging data available.</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Per-SKU breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Per-SKU Production Breakdown</CardTitle>
              <div className="flex gap-2">
                {(["production", "ims"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${sortBy === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  >
                    {s === "production" ? "Sort by Production" : "Sort by IMS"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sorted.map((sku: any, idx: number) => (
                <div key={sku.id} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{sku.name}</span>
                      <WeightBadge weight={sku.weight} />
                      <PackagingBadge type={sku.packagingType} />
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span className="text-amber-600 font-semibold">{fmt(sku.totalProduction)}</span>
                      <span className="text-emerald-600 font-semibold">{fmt(sku.totalIms)}</span>
                    </div>
                  </div>
                  <MiniBar value={sku.totalProduction} max={maxProd} color={PALETTE[idx % PALETTE.length]} />
                  <SparkLine data={sku.monthly.map((m: any) => m.production)} color={PALETTE[idx % PALETTE.length]} height={20} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ==================== FORECAST ACCURACY TAB ====================
  const ForecastAccuracyTab = () => {
    const accuracy = (forecastAccuracyByPeriod as any[]) ?? [];
    const overallAcc = overallForecastAccuracy as number | null;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            title="Overall Forecast Accuracy"
            value={overallAcc !== null ? `${overallAcc}%` : "N/A"}
            subtitle="Forecast vs Actual Production"
            color={overallAcc !== null && overallAcc >= 80 ? "#10b981" : overallAcc !== null && overallAcc >= 60 ? "#f59e0b" : "#ef4444"}
          />
          <KpiCard title="Periods Analysed" value={String(accuracy.length)} subtitle="Months with data" color="#3b82f6" />
          <KpiCard
            title="Best Period"
            value={accuracy.length > 0 ? accuracy.reduce((best: any, p: any) => (p.accuracy ?? 0) > (best.accuracy ?? 0) ? p : best, accuracy[0])?.period ?? "—" : "—"}
            subtitle="Highest accuracy"
            color="#10b981"
          />
          <KpiCard
            title="Worst Period"
            value={accuracy.length > 0 ? accuracy.reduce((worst: any, p: any) => (p.accuracy ?? 100) < (worst.accuracy ?? 100) ? p : worst, accuracy[0])?.period ?? "—" : "—"}
            subtitle="Lowest accuracy"
            color="#ef4444"
          />
        </div>

        {/* Forecast vs Actual vs Revised chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Forecast vs Actual Production vs Revised Forecast</CardTitle>
          </CardHeader>
          <CardContent>
            <StackedBarChart
              data={shortLabels.map((lbl: string, i: number) => ({
                label: lbl,
                values: {
                  actual: (monthlyProductionSeries as number[])[i] ?? 0,
                  forecast: ((monthlyForecastSeries as number[]) ?? [])[i] ?? 0,
                  revised: ((monthlyRevisedForecastSeries as number[]) ?? [])[i] ?? 0,
                },
              }))}
              keys={["forecast", "revised", "actual"]}
              colors={{ forecast: "#8b5cf6", revised: "#3b82f6", actual: "#f59e0b" }}
              labels={{ forecast: "Forecast", revised: "Revised Forecast", actual: "Actual Production" }}
              formatter={fmt}
            />
          </CardContent>
        </Card>

        {/* Per-period accuracy table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Forecast Accuracy by Period</CardTitle>
          </CardHeader>
          <CardContent>
            {accuracy.length === 0 ? (
              <p className="text-sm text-muted-foreground">No forecast data entered yet. Go to the Forecast Production page to enter forecast values.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted">
                      <th className="px-2 py-1.5 text-left font-medium">Period</th>
                      <th className="px-2 py-1.5 text-right font-medium text-purple-700">Forecast</th>
                      <th className="px-2 py-1.5 text-right font-medium text-blue-700">Revised Forecast</th>
                      <th className="px-2 py-1.5 text-right font-medium text-amber-600">Actual Production</th>
                      <th className="px-2 py-1.5 text-right font-medium">Variance</th>
                      <th className="px-2 py-1.5 text-center font-medium">Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accuracy.map((row: any, i: number) => {
                      const acc = row.accuracy as number | null;
                      const variance = row.actual - row.forecast;
                      return (
                        <tr key={i} className={`border-b hover:bg-muted/50 ${acc !== null && acc < 60 ? "bg-red-50/40" : acc !== null && acc >= 90 ? "bg-emerald-50/40" : ""}`}>
                          <td className="px-2 py-1.5 font-medium">{row.period}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-purple-700">{fmt(row.forecast)}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-blue-700">{row.revised > 0 ? fmt(row.revised) : "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-amber-600 font-semibold">{fmt(row.actual)}</td>
                          <td className={`px-2 py-1.5 text-right tabular-nums font-semibold ${variance >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                            {variance >= 0 ? "+" : ""}{fmt(variance)}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {acc !== null ? (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                acc >= 90 ? "bg-emerald-100 text-emerald-700" :
                                acc >= 70 ? "bg-blue-100 text-blue-700" :
                                acc >= 50 ? "bg-amber-100 text-amber-700" :
                                "bg-red-100 text-red-700"
                              }`}>{acc}%</span>
                            ) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  // ==================== STOCK HEALTH TAB ====================
  const StockHealthTab = () => {
    const top = (topSkusByIms as any[]) ?? [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Total IMS" value={fmt(totalIms)} subtitle="All periods" color="#10b981" trend={imsGrowthRate} />
          <KpiCard title="IMS Growth" value={imsGrowthRate !== null ? `${imsGrowthRate >= 0 ? "+" : ""}${imsGrowthRate}%` : "N/A"} subtitle="Recent vs prior half" color={imsGrowthRate !== null && imsGrowthRate >= 0 ? "#10b981" : "#ef4444"} />
          <KpiCard title="Top SKU by IMS" value={top.length > 0 ? top[0].name : "—"} subtitle={top.length > 0 ? `${fmt(top[0].totalIms)} units` : ""} color="#3b82f6" />
          <KpiCard title="Active SKUs" value={String(top.length)} subtitle="SKUs with IMS data" color="#8b5cf6" />
        </div>

        {/* Top 10 SKUs by IMS */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top SKUs by IMS Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {top.length === 0 ? (
              <p className="text-sm text-muted-foreground">No IMS data entered yet.</p>
            ) : (
              <div className="space-y-3">
                {top.map((sku: any, idx: number) => (
                  <div key={sku.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-muted-foreground w-5 text-right">{idx + 1}.</span>
                        <span className="text-sm font-medium">{sku.name}</span>
                        <WeightBadge weight={sku.weight} />
                        <PackagingBadge type={sku.packagingType} />
                      </div>
                      <span className="text-xs font-semibold text-emerald-700">{fmt(sku.totalIms)}</span>
                    </div>
                    <MiniBar value={sku.totalIms} max={top[0].totalIms} color={PALETTE[idx % PALETTE.length]} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monthly IMS trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly IMS Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <SparkLine data={monthlyImsSeries} color="#10b981" height={60} />
            <div className="mt-3 space-y-1">
              {shortLabels.map((lbl: string, i: number) => (
                <div key={lbl} className="flex items-center gap-2">
                  <div className="min-w-[55px] text-[10px] text-muted-foreground text-right">{lbl}</div>
                  <div className="flex-1 h-3 bg-muted rounded overflow-hidden">
                    <div className="h-full rounded transition-all duration-500 bg-emerald-500" style={{ width: `${Math.max(...(monthlyImsSeries as number[])) > 0 ? ((monthlyImsSeries as number[])[i] / Math.max(...(monthlyImsSeries as number[]))) * 100 : 0}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground min-w-[50px] text-right">{fmt((monthlyImsSeries as number[])[i])}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* IMS vs Production monthly comparison */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">IMS vs Production by Period</CardTitle>
          </CardHeader>
          <CardContent>
            <StackedBarChart
              data={shortLabels.map((lbl: string, i: number) => ({
                label: lbl,
                values: { production: (monthlyProductionSeries as number[])[i] ?? 0, ims: (monthlyImsSeries as number[])[i] ?? 0 },
              }))}
              keys={["production", "ims"]}
              colors={{ production: "#f59e0b", ims: "#10b981" }}
              labels={{ production: "Production", ims: "IMS" }}
              formatter={fmt}
            />
          </CardContent>
        </Card>

        {/* Per-SKU IMS breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">IMS by SKU (All)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[...(skuProductionBreakdown as any[])]
                .filter((s: any) => s.totalIms > 0)
                .sort((a: any, b: any) => b.totalIms - a.totalIms)
                .map((sku: any, idx: number) => (
                  <div key={sku.id} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{sku.name}</span>
                        <WeightBadge weight={sku.weight} />
                        <PackagingBadge type={sku.packagingType} />
                      </div>
                      <span className="text-xs font-semibold text-emerald-700">{fmt(sku.totalIms)}</span>
                    </div>
                    <MiniBar value={sku.totalIms} max={Math.max(...(skuProductionBreakdown as any[]).map((s: any) => s.totalIms), 1)} color={PALETTE[idx % PALETTE.length]} />
                  </div>
                ))}
              {(skuProductionBreakdown as any[]).every((s: any) => s.totalIms === 0) && (
                <p className="text-sm text-muted-foreground">No IMS data entered yet. Go to the IMS page to enter monthly IMS values.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ==================== CLEARANCE TAB ====================
  const ClearanceTab = () => {
    const [filterStatus, setFilterStatus] = useState<string>("all");

    const filtered = useMemo(() =>
      filterStatus === "all" ? clearanceBatches : (clearanceBatches as any[]).filter((b: any) => b.status === filterStatus),
      [filterStatus]
    );

    const delayedBatches = (clearanceBatches as any[]).filter((b: any) => b.daysAtPort !== null && b.daysAtPort > 7 && b.status !== "Cleared");
    const statusSegments = Object.entries(statusCounts as Record<string, number>)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => ({ label: status, value: count, color: STATUS_COLOR[status] ?? "#9ca3af" }));

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Total Produced" value={fmt(totalProduction)} subtitle="All batches" color="#f59e0b" />
          <KpiCard title="Total Cleared" value={fmt(totalCleared)} subtitle="In Planning FG" color="#10b981" />
          <KpiCard title="Pending Clearance" value={fmt(totalPending)} subtitle="Still at port" color="#f97316" />
          <KpiCard title="Clearance Rate" value={`${clearanceRate}%`} subtitle={`${batchesWithDelay} batches delayed`} color={clearanceRate >= 80 ? "#10b981" : clearanceRate >= 50 ? "#f59e0b" : "#ef4444"} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Batch Status Distribution</CardTitle></CardHeader>
            <CardContent><DonutChart segments={statusSegments} /></CardContent>
          </Card>

          <Card className={batchesWithDelay > 0 ? "border-red-200" : ""}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Delayed Batches
                {batchesWithDelay > 0 && (
                  <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold">{batchesWithDelay} batches &gt;7 days</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {delayedBatches.length === 0 ? (
                <p className="text-sm text-emerald-600 font-medium">No batches delayed at port.</p>
              ) : (
                <div className="space-y-2">
                  {delayedBatches.slice(0, 8).map((b: any, i: number) => (
                    <div key={i} className="flex items-center justify-between text-xs border-b pb-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium">{b.skuName}</span>
                        <WeightBadge weight={b.weight} />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{b.periodLabel}</span>
                        <span className="bg-red-100 text-red-700 px-1.5 py-0.5 rounded text-[10px] font-bold">{b.daysAtPort}d at port</span>
                      </div>
                    </div>
                  ))}
                  {delayedBatches.length > 8 && (
                    <p className="text-[10px] text-muted-foreground">+{delayedBatches.length - 8} more delayed batches</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Clearance Progress by Weight</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(weightBreakdown as any[]).filter((w: any) => w.totalProduction > 0).map((w: any) => {
                const wBatches = (clearanceBatches as any[]).filter((b: any) => b.weight === w.weight);
                const wCleared = wBatches.reduce((s: number, b: any) => s + b.clearedQty, 0);
                const wTotal = wBatches.reduce((s: number, b: any) => s + b.totalQty, 0);
                const wRate = wTotal > 0 ? Math.round((wCleared / wTotal) * 100) : 0;
                return (
                  <div key={w.weight} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <WeightBadge weight={w.weight} />
                      <span className="text-muted-foreground">{fmt(wCleared)} / {fmt(wTotal)} cleared ({wRate}%)</span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${wRate}%`, backgroundColor: WEIGHT_COLOR[w.weight] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">All Clearance Batches</CardTitle>
              <div className="flex gap-1 flex-wrap">
                {["all", ...Object.keys(statusCounts as Record<string, number>)].map((s) => (
                  <button
                    key={s}
                    onClick={() => setFilterStatus(s)}
                    className={`px-2 py-0.5 text-[10px] rounded transition-colors ${filterStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
                  >
                    {s === "all" ? "All" : s}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted">
                    <th className="px-2 py-1.5 text-left font-medium">SKU</th>
                    <th className="px-2 py-1.5 text-left font-medium">Weight</th>
                    <th className="px-2 py-1.5 text-left font-medium">Packaging</th>
                    <th className="px-2 py-1.5 text-left font-medium">Period</th>
                    <th className="px-2 py-1.5 text-right font-medium">Produced</th>
                    <th className="px-2 py-1.5 text-right font-medium text-teal-700">Cleared</th>
                    <th className="px-2 py-1.5 text-right font-medium text-amber-600">Pending</th>
                    <th className="px-2 py-1.5 text-center font-medium">Status</th>
                    <th className="px-2 py-1.5 text-center font-medium">Days at Port</th>
                    <th className="px-2 py-1.5 text-left font-medium">Cleared Date</th>
                  </tr>
                </thead>
                <tbody>
                  {(filtered as any[]).map((b: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/50">
                      <td className="px-2 py-1.5 font-medium">{b.skuName}</td>
                      <td className="px-2 py-1.5"><WeightBadge weight={b.weight} /></td>
                      <td className="px-2 py-1.5"><PackagingBadge type={b.packagingType} /></td>
                      <td className="px-2 py-1.5 text-muted-foreground">{b.periodLabel}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmt(b.totalQty)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-teal-700 font-semibold">{b.clearedQty > 0 ? fmt(b.clearedQty) : "—"}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-amber-600">{b.pendingQty > 0 ? fmt(b.pendingQty) : "—"}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${STATUS_COLOR[b.status] ?? "#9ca3af"}20`, color: STATUS_COLOR[b.status] ?? "#9ca3af" }}>
                          {b.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {b.daysAtPort !== null ? (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${b.daysAtPort > 7 && b.status !== "Cleared" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                            {b.daysAtPort}d{b.daysAtPort > 7 && b.status !== "Cleared" ? " !" : ""}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">{b.clearedDate ?? "—"}</td>
                    </tr>
                  ))}
                  {(filtered as any[]).length === 0 && (
                    <tr><td colSpan={10} className="px-2 py-4 text-center text-muted-foreground">No batches found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const RunningRateTab = () => {
    const [rrView, setRrView] = useState<"sku" | "flavor" | "weight">("sku");
    const [rrSort, setRrSort] = useState<"avg3m" | "trend" | "name">("avg3m");
    if (loadingRunRate) return <div className="p-4 text-sm text-muted-foreground">Loading running rate...</div>;
    if (!runningRateData) return <div className="p-4 text-sm text-muted-foreground">No IMS data available for running rate analysis.</div>;
    const rd = runningRateData as any;
    const sLabels = (rd.periodLabels as string[]).map((l: string) => l.length > 5 ? l.slice(0, 3) + "'" + l.slice(-2) : l);

    const sortedSkus = [...(rd.skuRates as any[])].sort((a, b) => {
      if (rrSort === "avg3m") return b.avg3m - a.avg3m;
      if (rrSort === "trend") return b.trend - a.trend;
      return a.name.localeCompare(b.name);
    });

    const trendBadge = (t: string, pct: number) => {
      const cls = t === "growing" ? "bg-emerald-100 text-emerald-700" : t === "declining" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600";
      return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls}`}>{t === "growing" ? "▲" : t === "declining" ? "▼" : "—"} {pct}%</span>;
    };

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Total IMS" value={fmt(rd.totalIms)} color="#3b82f6" />
          <KpiCard title="Avg 3M Running Rate" value={fmt(rd.totalAvg3m)} color="#10b981" />
          <KpiCard title="Overall Trend" value={`${rd.overallTrend >= 0 ? "+" : ""}${rd.overallTrend}%`} subtitle="3M vs prior 3M" color={rd.overallTrend >= 0 ? "#10b981" : "#ef4444"} />
          <KpiCard title="Active SKUs" value={String(rd.totalSkus)} color="#8b5cf6" />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly IMS Running Rate — {country}</CardTitle>
          </CardHeader>
          <CardContent>
            <SparkLine data={rd.monthlyTotals} color="#3b82f6" height={60} />
            <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
              {sLabels.filter((_: string, i: number) => i % Math.max(1, Math.floor(sLabels.length / 8)) === 0).map((l: string, i: number) => (
                <span key={i}>{l}</span>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 items-center flex-wrap">
          <span className="text-xs text-muted-foreground">View:</span>
          {(["sku", "flavor", "weight"] as const).map(v => (
            <button key={v} onClick={() => setRrView(v)} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${rrView === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {v === "sku" ? "By SKU" : v === "flavor" ? "By Flavor" : "By Weight"}
            </button>
          ))}
          {rrView === "sku" && (
            <>
              <span className="text-xs text-muted-foreground ml-4">Sort:</span>
              {(["avg3m", "trend", "name"] as const).map(s => (
                <button key={s} onClick={() => setRrSort(s)} className={`px-2 py-1 text-xs rounded transition-colors ${rrSort === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                  {s === "avg3m" ? "Running Rate" : s === "trend" ? "Trend" : "Name"}
                </button>
              ))}
            </>
          )}
        </div>

        {rrView === "sku" && (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="text-left p-2 font-semibold sticky left-0 bg-muted/50">SKU</th>
                      <th className="text-center p-2 font-semibold">Weight</th>
                      <th className="text-right p-2 font-semibold">3M Avg</th>
                      <th className="text-right p-2 font-semibold">6M Avg</th>
                      <th className="text-right p-2 font-semibold">All-Time Avg</th>
                      <th className="text-right p-2 font-semibold">Last Month</th>
                      <th className="text-center p-2 font-semibold">Trend</th>
                      <th className="text-center p-2 font-semibold">Peak</th>
                      <th className="p-2 font-semibold min-w-[120px]">Monthly Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSkus.map((sku: any, idx: number) => (
                      <tr key={sku.id} className="border-b hover:bg-muted/30 transition-colors">
                        <td className="p-2 font-medium sticky left-0 bg-white">
                          <div>{sku.name}</div>
                          <div className="text-[10px] text-muted-foreground">{sku.category} · {sku.packagingType} Pkg</div>
                        </td>
                        <td className="text-center p-2"><WeightBadge weight={sku.weight} /></td>
                        <td className="text-right p-2 font-semibold">{fmt(sku.avg3m)}</td>
                        <td className="text-right p-2">{fmt(sku.avg6m)}</td>
                        <td className="text-right p-2">{fmt(sku.avgAll)}</td>
                        <td className="text-right p-2">{fmt(sku.lastMonthValue)}</td>
                        <td className="text-center p-2">{trendBadge(sku.trendDirection, Math.abs(sku.trend))}</td>
                        <td className="text-center p-2">
                          <div className="text-[10px]">{fmt(sku.peakValue)}</div>
                          <div className="text-[9px] text-muted-foreground">{sku.peakMonth}</div>
                        </td>
                        <td className="p-2">
                          <SparkLine data={sku.monthlyValues} color={PALETTE[idx % PALETTE.length]} height={28} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {rrView === "flavor" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {(rd.flavorSummary as any[]).map((f: any, idx: number) => (
              <Card key={f.flavor}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-sm font-semibold">{f.flavor}</p>
                      <p className="text-[10px] text-muted-foreground">{f.skuCount} SKU(s)</p>
                    </div>
                    {trendBadge(f.trend > 5 ? "growing" : f.trend < -5 ? "declining" : "stable", Math.abs(f.trend))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><p className="text-muted-foreground">Total IMS</p><p className="font-semibold">{fmt(f.totalIms)}</p></div>
                    <div><p className="text-muted-foreground">3M Avg</p><p className="font-semibold">{fmt(f.avg3m)}</p></div>
                  </div>
                  <div className="mt-2">
                    <MiniBar value={f.totalIms} max={(rd.flavorSummary as any[])[0]?.totalIms || 1} color={PALETTE[idx % PALETTE.length]} />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {rrView === "weight" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(rd.weightSummary as any[]).map((w: any) => (
              <Card key={w.weight}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <WeightBadge weight={w.weight} />
                    {trendBadge(w.trend > 5 ? "growing" : w.trend < -5 ? "declining" : "stable", Math.abs(w.trend))}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total IMS</span><span className="font-semibold">{fmt(w.totalIms)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">3M Running Rate</span><span className="font-semibold">{fmt(w.avg3m)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">SKUs</span><span className="font-semibold">{w.skuCount}</span></div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  };

  const StockLevelTab = () => {
    const [slSort, setSlSort] = useState<"weeks" | "stock" | "health" | "name">("weeks");
    if (loadingStockLvl) return <div className="p-4 text-sm text-muted-foreground">Loading stock levels...</div>;
    if (!stockLevelsData) return <div className="p-4 text-sm text-muted-foreground">No planning data available for stock level analysis.</div>;
    const sd = stockLevelsData as any;
    const sLabels = (sd.periodLabels as string[]).map((l: string) => l.length > 5 ? l.slice(0, 3) + "'" + l.slice(-2) : l);

    const sortedSkus = [...(sd.skuStocks as any[])].sort((a, b) => {
      if (slSort === "weeks") return a.currentWeeks - b.currentWeeks;
      if (slSort === "stock") return b.currentClosingStock - a.currentClosingStock;
      if (slSort === "health") return a.healthScore - b.healthScore;
      return a.name.localeCompare(b.name);
    });

    const zoneBadge = (zone: string) => {
      const cls: Record<string, string> = {
        "Healthy": "bg-green-100 text-green-700",
        "Critical": "bg-red-100 text-red-700",
        "Overstock": "bg-orange-100 text-orange-700",
        "Negative": "bg-gray-900 text-white",
        "Out of Stock": "bg-gray-100 text-gray-600",
      };
      return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls[zone] || "bg-gray-100 text-gray-600"}`}>{zone}</span>;
    };

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard title="Total Closing Stock" value={fmt(sd.totalClosingStock)} subtitle="Current period" color="#3b82f6" />
          <KpiCard title="Avg Weeks of Stock" value={`${sd.avgWeeksAll}w`} subtitle="Target: 4–6 weeks" color={sd.avgWeeksAll >= 4 && sd.avgWeeksAll <= 6 ? "#10b981" : "#ef4444"} />
          <KpiCard title="Health Score" value={`${sd.avgHealthScore}%`} subtitle="% periods in Healthy zone" color={sd.avgHealthScore >= 50 ? "#10b981" : "#ef4444"} />
          <KpiCard title="Total SKUs" value={String(sd.totalSkus)} color="#8b5cf6" />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Current Zone Distribution — {country}</CardTitle>
          </CardHeader>
          <CardContent>
            <DonutChart segments={(sd.zoneDistribution as any[]).map((z: any) => ({ label: `${z.zone} (${z.count})`, value: z.count, color: z.color }))} size={140} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Zone Trend Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <StackedBarChart
              data={(sd.periodZones as any[]).map((pz: any, i: number) => ({
                label: sLabels[i] || pz.period,
                values: pz.zones,
              }))}
              keys={["Healthy", "Critical", "Overstock", "Out of Stock", "Negative"]}
              colors={{ "Healthy": "#16a34a", "Critical": "#dc2626", "Overstock": "#ea580c", "Out of Stock": "#6b7280", "Negative": "#111827" }}
              labels={{ "Healthy": "Healthy", "Critical": "Critical", "Overstock": "Overstock", "Out of Stock": "Out of Stock", "Negative": "Negative" }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Stock by Weight</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(sd.weightStockSummary as any[]).map((ws: any) => (
                <div key={ws.weight} className="border rounded-lg p-3">
                  <WeightBadge weight={ws.weight} />
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total Stock</span><span className="font-semibold">{fmt(ws.totalStock)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Avg Weeks</span><span className="font-semibold">{ws.avgWeeks}w</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">SKUs</span><span className="font-semibold">{ws.skuCount}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">Sort by:</span>
          {(["weeks", "stock", "health", "name"] as const).map(s => (
            <button key={s} onClick={() => setSlSort(s)} className={`px-2 py-1 text-xs rounded transition-colors ${slSort === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {s === "weeks" ? "Weeks of Stock" : s === "stock" ? "Closing Stock" : s === "health" ? "Health Score" : "Name"}
            </button>
          ))}
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-semibold sticky left-0 bg-muted/50">SKU</th>
                    <th className="text-center p-2 font-semibold">Weight</th>
                    <th className="text-center p-2 font-semibold">Zone</th>
                    <th className="text-right p-2 font-semibold">Closing Stock</th>
                    <th className="text-right p-2 font-semibold">Weeks</th>
                    <th className="text-right p-2 font-semibold">Coverage</th>
                    <th className="text-center p-2 font-semibold">Health</th>
                    <th className="p-2 font-semibold min-w-[120px]">Stock Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSkus.map((sku: any, idx: number) => (
                    <tr key={sku.id} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="p-2 font-medium sticky left-0 bg-white">
                        <div>{sku.name}</div>
                        <div className="text-[10px] text-muted-foreground">{sku.category} · {sku.packagingType} Pkg</div>
                      </td>
                      <td className="text-center p-2"><WeightBadge weight={sku.weight} /></td>
                      <td className="text-center p-2">{zoneBadge(sku.currentZone)}</td>
                      <td className="text-right p-2 font-semibold">{fmt(sku.currentClosingStock)}</td>
                      <td className="text-right p-2">
                        <span className={`font-semibold ${sku.currentWeeks >= 4 && sku.currentWeeks <= 6 ? "text-green-600" : sku.currentWeeks < 4 ? "text-red-600" : "text-orange-600"}`}>
                          {Math.abs(sku.currentWeeks) >= 99 ? (sku.currentWeeks > 0 ? "∞" : "-∞") : `${sku.currentWeeks}w`}
                        </span>
                      </td>
                      <td className="text-right p-2">{sku.coverageMonths > 0 ? `${sku.coverageMonths}mo` : "—"}</td>
                      <td className="text-center p-2">
                        <div className="flex items-center gap-1 justify-center">
                          <div className="w-8 h-2 bg-muted rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(sku.healthScore, 100)}%`, backgroundColor: sku.healthScore >= 50 ? "#16a34a" : sku.healthScore >= 25 ? "#ea580c" : "#dc2626" }} />
                          </div>
                          <span className="text-[10px]">{sku.healthScore}%</span>
                        </div>
                      </td>
                      <td className="p-2">
                        <SparkLine data={sku.closingStocks} color={PALETTE[idx % PALETTE.length]} height={28} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const ByFlavourTab = () => {
    const [sortKey, setSortKey] = useState<"production" | "ims" | "forecast">("production");
    const fb = flavourBreakdown as any[] ?? [];
    const sorted = useMemo(() => {
      return [...fb].sort((a, b) => {
        if (sortKey === "production") return b.totalProduction - a.totalProduction;
        if (sortKey === "ims") return b.totalIms - a.totalIms;
        return b.totalForecast - a.totalForecast;
      });
    }, [fb, sortKey]);
    const maxVal = Math.max(...sorted.map((f: any) => Math.max(f.totalProduction, f.totalIms, f.totalForecast)), 1);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Forecast by Flavour</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={fb.filter((f: any) => f.totalForecast > 0).map((f: any, i: number) => ({
                  label: f.name, value: f.totalForecast, color: PALETTE[i % PALETTE.length],
                }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Production by Flavour</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={fb.filter((f: any) => f.totalProduction > 0).map((f: any, i: number) => ({
                  label: f.name, value: f.totalProduction, color: PALETTE[i % PALETTE.length],
                }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">IMS by Flavour</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={fb.filter((f: any) => f.totalIms > 0).map((f: any, i: number) => ({
                  label: f.name, value: f.totalIms, color: PALETTE[i % PALETTE.length],
                }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Flavour Breakdown — Forecast / Production / IMS / Share %</CardTitle>
              <div className="flex gap-1">
                {(["production", "ims", "forecast"] as const).map((s) => (
                  <button key={s} onClick={() => setSortKey(s)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${sortKey === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
                    Sort by {s === "production" ? "Production" : s === "ims" ? "IMS" : "Forecast"}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background z-10">
                  <tr className="border-b">
                    <th className="text-left py-2 px-2 font-medium text-muted-foreground">Flavour</th>
                    <th className="text-left py-2 px-1 font-medium text-muted-foreground">SKUs</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Forecast</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">Production</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">IMS</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">% Forecast</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">% Prod</th>
                    <th className="text-right py-2 px-2 font-medium text-muted-foreground">% IMS</th>
                    <th className="py-2 px-2 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((f: any, i: number) => (
                    <tr key={f.name} className="border-b hover:bg-muted/30 transition-colors">
                      <td className="py-2 px-2 font-medium">{f.name}</td>
                      <td className="py-2 px-1 text-muted-foreground">{f.skuCount}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs">{fmt(f.totalForecast)}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs">{fmt(f.totalProduction)}</td>
                      <td className="py-2 px-2 text-right font-mono text-xs">{fmt(f.totalIms)}</td>
                      <td className="py-2 px-2 text-right font-semibold text-violet-600">{f.pctForecast}%</td>
                      <td className="py-2 px-2 text-right font-semibold text-amber-600">{f.pctProduction}%</td>
                      <td className="py-2 px-2 text-right font-semibold text-emerald-600">{f.pctIms}%</td>
                      <td className="py-2 px-2">
                        <MiniBar value={sortKey === "ims" ? f.totalIms : sortKey === "forecast" ? f.totalForecast : f.totalProduction} max={maxVal} color={PALETTE[i % PALETTE.length]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const ByWeightTab = () => {
    const wb = (weightBreakdown as any[]) ?? [];
    const totalProd = wb.reduce((s: number, w: any) => s + w.totalProduction, 0);
    const totalImsW = wb.reduce((s: number, w: any) => s + w.totalIms, 0);
    const totalFcast = wb.reduce((s: number, w: any) => s + w.totalForecast, 0);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Forecast by Weight</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={wb.filter((w: any) => w.totalForecast > 0).map((w: any) => ({
                  label: `${w.weight} (${w.skuCount} SKUs)`, value: w.totalForecast, color: WEIGHT_COLOR[w.weight] ?? "#6b7280",
                }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Production by Weight</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={wb.filter((w: any) => w.totalProduction > 0).map((w: any) => ({
                  label: `${w.weight} (${w.skuCount} SKUs)`, value: w.totalProduction, color: WEIGHT_COLOR[w.weight] ?? "#6b7280",
                }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">IMS by Weight</CardTitle></CardHeader>
            <CardContent>
              <DonutChart
                segments={wb.filter((w: any) => w.totalIms > 0).map((w: any) => ({
                  label: w.weight, value: w.totalIms, color: WEIGHT_COLOR[w.weight] ?? "#6b7280",
                }))}
                formatter={fmt}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Weight Breakdown — Forecast / Production / IMS / Share %</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-2 font-medium text-muted-foreground">Weight</th>
                  <th className="text-left py-2 px-1 font-medium text-muted-foreground">SKUs</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Forecast</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">Production</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">IMS</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">% Forecast</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">% Prod</th>
                  <th className="text-right py-2 px-2 font-medium text-muted-foreground">% IMS</th>
                  <th className="py-2 px-2 w-40"></th>
                </tr>
              </thead>
              <tbody>
                {wb.map((w: any) => (
                  <tr key={w.weight} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-2"><WeightBadge weight={w.weight} /></td>
                    <td className="py-3 px-1 text-muted-foreground">{w.skuCount}</td>
                    <td className="py-3 px-2 text-right font-mono text-xs">{fmt(w.totalForecast)}</td>
                    <td className="py-3 px-2 text-right font-mono text-xs">{fmt(w.totalProduction)}</td>
                    <td className="py-3 px-2 text-right font-mono text-xs">{fmt(w.totalIms)}</td>
                    <td className="py-3 px-2 text-right font-semibold text-violet-600">{w.pctForecast}%</td>
                    <td className="py-3 px-2 text-right font-semibold text-amber-600">{w.pctProduction}%</td>
                    <td className="py-3 px-2 text-right font-semibold text-emerald-600">{w.pctIms}%</td>
                    <td className="py-3 px-2">
                      <div className="space-y-1">
                        <MiniBar value={w.totalForecast} max={totalFcast} color="#8b5cf6" label={`${w.pctForecast}%`} />
                        <MiniBar value={w.totalProduction} max={totalProd} color="#f59e0b" label={`${w.pctProduction}%`} />
                        <MiniBar value={w.totalIms} max={totalImsW} color="#10b981" label={`${w.pctIms}%`} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td className="py-2 px-2">Total</td>
                  <td className="py-2 px-1">{wb.reduce((s: number, w: any) => s + w.skuCount, 0)}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{fmt(totalFcast)}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{fmt(totalProd)}</td>
                  <td className="py-2 px-2 text-right font-mono text-xs">{fmt(totalImsW)}</td>
                  <td className="py-2 px-2 text-right">100%</td>
                  <td className="py-2 px-2 text-right">100%</td>
                  <td className="py-2 px-2 text-right">100%</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  };

    return (
    <div className="p-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold">{country} — Analysis</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Production, clearance, IMS, forecast accuracy, and stock health analysis for {country}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted p-1 rounded-lg mb-4">
          <TabsTrigger value="production">Production</TabsTrigger>
          <TabsTrigger value="forecast">Forecast Accuracy</TabsTrigger>
          <TabsTrigger value="ims">IMS & Stock Health</TabsTrigger>
          <TabsTrigger value="clearance">
            Clearance
            {batchesWithDelay > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded bg-red-500 text-white text-[9px] font-bold">{batchesWithDelay}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="byflavour" className="font-semibold text-violet-600">By Flavour</TabsTrigger>
          <TabsTrigger value="byweight" className="font-semibold text-orange-600">By Weight</TabsTrigger>
          <TabsTrigger value="runrate" className="font-semibold text-blue-600">Running Rate</TabsTrigger>
          <TabsTrigger value="stocklvl" className="font-semibold text-emerald-600">Stock Levels</TabsTrigger>
        </TabsList>

        <TabsContent value="production"><ProductionTab /></TabsContent>
        <TabsContent value="forecast"><ForecastAccuracyTab /></TabsContent>
        <TabsContent value="ims"><StockHealthTab /></TabsContent>
        <TabsContent value="clearance"><ClearanceTab /></TabsContent>
        <TabsContent value="byflavour"><ByFlavourTab /></TabsContent>
        <TabsContent value="byweight"><ByWeightTab /></TabsContent>
        <TabsContent value="runrate"><RunningRateTab /></TabsContent>
        <TabsContent value="stocklvl"><StockLevelTab /></TabsContent>
      </Tabs>
    </div>
  );
}
