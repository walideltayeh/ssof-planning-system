import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useUnit } from "@/contexts/UnitContext";

// ==================== HELPER COMPONENTS ====================

function KpiCard({ title, value, subtitle, color }: { title: string; value: string; subtitle?: string; color: string }) {
  return (
    <Card className="relative overflow-hidden">
      <div className={`absolute top-0 left-0 w-1 h-full`} style={{ backgroundColor: color }} />
      <CardContent className="p-4 pl-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
        <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </CardContent>
    </Card>
  );
}

function MiniBar({ value, max, color, label }: { value: number; max: number; color: string; label?: string }) {
  const pct = max > 0 ? Math.min(value / max * 100, 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      {label && <span className="text-xs text-muted-foreground min-w-[40px] text-right">{label}</span>}
    </div>
  );
}

function HorizontalBarChart({ items, maxValue, colorFn, formatter }: {
  items: { label: string; value: number; sublabel?: string }[];
  maxValue: number;
  colorFn: (idx: number) => string;
  formatter?: (n: number) => string;
}) {
  const f = formatter ?? ((n: number) => n.toLocaleString());
  return (
    <div className="space-y-2">
      {items.map((item, idx) => (
        <div key={item.label} className="flex items-center gap-3">
          <div className="min-w-[120px] text-xs font-medium truncate" title={item.label}>{item.label}</div>
          <div className="flex-1 h-5 bg-muted rounded overflow-hidden relative">
            <div
              className="h-full rounded transition-all duration-700 flex items-center justify-end pr-1"
              style={{ width: `${maxValue > 0 ? Math.min(item.value / maxValue * 100, 100) : 0}%`, backgroundColor: colorFn(idx) }}
            >
              {item.value / maxValue > 0.15 && (
                <span className="text-[10px] font-semibold text-white">{f(item.value)}</span>
              )}
            </div>
          </div>
          {item.value / maxValue <= 0.15 && (
            <span className="text-xs text-muted-foreground">{f(item.value)}</span>
          )}
        </div>
      ))}
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
  const f = formatter ?? ((n: number) => n.toLocaleString());
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
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" className="text-lg font-bold fill-foreground">{f(total)}</text>
        <text x={size / 2} y={size / 2 + 12} textAnchor="middle" className="text-[9px] fill-muted-foreground">Total</text>
      </svg>
      <div className="space-y-1">
        {segments.map((seg, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: seg.color }} />
            <span className="text-muted-foreground">{seg.label}</span>
            <span className="font-semibold ml-auto">{Math.round(seg.value / total * 100)}%</span>
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
  const f = formatter ?? ((n: number) => n.toLocaleString());
  const maxTotal = Math.max(...data.map(d => keys.reduce((s, k) => s + (d.values[k] || 0), 0)), 1);
  return (
    <div className="space-y-1">
      <div className="flex gap-3 mb-2">
        {keys.map(k => (
          <div key={k} className="flex items-center gap-1 text-[10px]">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: colors[k] }} />
            <span className="text-muted-foreground">{labels[k]}</span>
          </div>
        ))}
      </div>
      {data.map(d => {
        const total = keys.reduce((s, k) => s + (d.values[k] || 0), 0);
        return (
          <div key={d.label} className="flex items-center gap-2">
            <div className="min-w-[60px] text-[10px] text-muted-foreground text-right truncate">{d.label}</div>
            <div className="flex-1 h-4 bg-muted rounded overflow-hidden flex">
              {keys.map(k => {
                const pct = maxTotal > 0 ? (d.values[k] || 0) / maxTotal * 100 : 0;
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

// ==================== MAIN ANALYSIS PAGE ====================

const PALETTE = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16"];

export default function AnalysisPage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [isExporting, setIsExporting] = useState(false);
  const { formatVal } = useUnit();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/export-analysis");
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error || "Export failed");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = response.headers.get("Content-Disposition");
      const filenameMatch = disposition?.match(/filename=(.+)/);
      a.download = filenameMatch ? filenameMatch[1] : "SSOF_Analysis.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Analysis exported successfully");
    } catch (err: any) {
      toast.error("Export failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsExporting(false);
    }
  };

  const { data: overview, isLoading: loadingOverview } = trpc.analysis.overview.useQuery();
  const { data: bySkuData, isLoading: loadingSku } = trpc.analysis.bySku.useQuery();
  const { data: byWeightData, isLoading: loadingWeight } = trpc.analysis.byWeight.useQuery();
  const { data: byCategoryData, isLoading: loadingCategory } = trpc.analysis.byCategory.useQuery();
  const { data: byFlavorData, isLoading: loadingFlavor } = trpc.analysis.byFlavor.useQuery();
  const { data: productionData, isLoading: loadingProduction } = trpc.analysis.production.useQuery();
  const { data: stockSnapshot, isLoading: loadingSnapshot } = trpc.analysis.stockSnapshot.useQuery();
  const { data: runningRateData, isLoading: loadingRunRate } = trpc.country.runningRate.useQuery({ country: "Lebanon" });
  const { data: stockLevelsData, isLoading: loadingStockLvl } = trpc.country.stockLevels.useQuery({ country: "Lebanon" });

  const formatNum = (n: number) => formatVal(n);

  // ==================== OVERVIEW TAB ====================
  const OverviewTab = () => {
    if (loadingOverview || !overview) return <div className="p-4 text-sm text-muted-foreground">Loading overview...</div>;
    return (
      <div className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard title="Total SKUs" value={String(overview.totalSkus)} color="#3b82f6" />
          <KpiCard title="Total Forecast" value={formatNum(overview.totalForecast)} subtitle="All periods" color="#10b981" />
          <KpiCard title="Total Production" value={formatNum(overview.totalProduction)} subtitle="Shipment" color="#f59e0b" />
          <KpiCard title="Total Arrival" value={formatNum(overview.totalArrival)} subtitle="To Regie" color="#8b5cf6" />
          <KpiCard title="Avg Stock Weeks" value={`${overview.avgWeeksOfStock}w`} subtitle="Closing stock" color={overview.avgWeeksOfStock >= 4 && overview.avgWeeksOfStock <= 6 ? "#10b981" : "#ef4444"} />
        </div>

        {/* Current Month Closing Stock by SKU */}
        {bySkuData && (() => {
          const skuList = [...(bySkuData as any[])].filter((s: any) => (s.currentStockMC ?? 0) !== 0).sort((a: any, b: any) => a.currentStockMC - b.currentStockMC);
          const totalCS = (bySkuData as any[]).reduce((sum: number, s: any) => sum + (s.currentStockMC ?? 0), 0);
          return (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Current Month Closing Stock by SKU</CardTitle>
                  <span className={`text-sm font-bold px-2 py-0.5 rounded ${totalCS >= 0 ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-600"}`}>
                    Total: {formatNum(totalCS)} MC
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Same values as shown in Planning FG &quot;Closing Stock&quot; row for the current month</p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-muted">
                        <th className="text-left p-2 font-semibold border-b">SKU</th>
                        <th className="text-center p-2 font-semibold border-b">Weight</th>
                        <th className="text-center p-2 font-semibold border-b">Category</th>
                        <th className="text-right p-2 font-semibold border-b">Closing Stock (MC)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skuList.map((sku: any) => (
                        <tr key={sku.id} className="border-b hover:bg-muted/30">
                          <td className="p-2 font-medium">{sku.name}</td>
                          <td className="text-center p-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${sku.weight === '50g' ? 'bg-blue-100 text-blue-700' : sku.weight === '250g' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{sku.weight}</span>
                          </td>
                          <td className="text-center p-2 text-[10px]">{sku.category}</td>
                          <td className={`text-right p-2 font-bold font-mono ${sku.currentStockMC > 0 ? "text-blue-700" : sku.currentStockMC < 0 ? "text-red-600" : "text-gray-500"}`}>
                            {formatNum(sku.currentStockMC ?? 0)}
                          </td>
                        </tr>
                      ))}
                      {skuList.length === 0 && (
                        <tr><td colSpan={4} className="p-3 text-center text-muted-foreground">No SKUs with non-zero closing stock</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Monthly Trend */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Trend: Forecast vs Production vs Arrival vs Closing Stock</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Forecast Trend</p>
                <SparkLine data={overview.monthlyTrend.map(m => m.forecast)} color="#10b981" height={50} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Production Trend</p>
                <SparkLine data={overview.monthlyTrend.map(m => m.production)} color="#f59e0b" height={50} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Arrival Trend</p>
                <SparkLine data={overview.monthlyTrend.map(m => m.arrival)} color="#8b5cf6" height={50} />
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Closing Stock Trend</p>
                <SparkLine data={overview.monthlyTrend.map((m: any) => m.closingStock ?? 0)} color="#ef4444" height={50} />
              </div>
            </div>
            <StackedBarChart
              data={overview.monthlyTrend.map(m => ({
                label: m.period.slice(0, 3) + "'" + m.period.slice(-2),
                values: { forecast: m.forecast, production: m.production, arrival: m.arrival, closingStock: (m as any).closingStock ?? 0 },
              }))}
              keys={["forecast", "production", "arrival", "closingStock"]}
              colors={{ forecast: "#10b981", production: "#f59e0b", arrival: "#8b5cf6", closingStock: "#ef4444" }}
              labels={{ forecast: "Forecast", production: "Production", arrival: "Arrival", closingStock: "Closing Stock" }}
              formatter={formatNum}
            />
          </CardContent>
        </Card>
      </div>
    );
  };

  // ==================== BY SKU TAB ====================
  const BySkuTab = () => {
    const [sortBy, setSortBy] = useState<"forecast" | "production" | "accuracy" | "stock">("forecast");
    if (loadingSku || !bySkuData) return <div className="p-4 text-sm text-muted-foreground">Loading SKU analysis...</div>;

    const sorted = [...bySkuData].sort((a, b) => {
      switch (sortBy) {
        case "forecast": return b.totalForecast - a.totalForecast;
        case "production": return b.totalProduction - a.totalProduction;
        case "accuracy": return b.forecastAccuracy - a.forecastAccuracy;
        case "stock": return b.avgWeeksOfStock - a.avgWeeksOfStock;
      }
    });

    const maxForecast = Math.max(...bySkuData.map(s => s.totalForecast), 1);

    return (
      <div className="space-y-4">
        {/* Sort controls */}
        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">Sort by:</span>
          {(["forecast", "production", "accuracy", "stock"] as const).map(s => (
            <button
              key={s}
              onClick={() => setSortBy(s)}
              className={`px-2 py-1 text-xs rounded transition-colors ${sortBy === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {s === "forecast" ? "Forecast" : s === "production" ? "Production" : s === "accuracy" ? "Accuracy" : "Stock Weeks"}
            </button>
          ))}
        </div>

        {/* SKU Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map((sku, idx) => (
            <Card key={sku.id} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: PALETTE[idx % PALETTE.length] }} />
              <CardContent className="p-3 pl-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-semibold">{sku.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        sku.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                        sku.weight === '250g' ? 'bg-amber-100 text-amber-700' :
                        'bg-rose-100 text-rose-700'
                      }`}>{sku.weight}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sku.category === "Core" ? "bg-emerald-100 text-emerald-700" : "bg-violet-100 text-violet-700"}`}>{sku.category}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold" style={{ color: sku.avgWeeksOfStock >= 4 && sku.avgWeeksOfStock <= 6 ? "#10b981" : sku.avgWeeksOfStock < 4 ? "#ef4444" : "#f59e0b" }}>
                      {sku.avgWeeksOfStock}w
                    </p>
                    <p className="text-[10px] text-muted-foreground">Avg Stock</p>
                  </div>
                </div>

                <div className="space-y-1.5 mt-3">
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Forecast</span>
                    <span className="font-semibold">{formatNum(sku.totalForecast)}</span>
                  </div>
                  <MiniBar value={sku.totalForecast} max={maxForecast} color="#10b981" />

                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">Production</span>
                    <span className="font-semibold">{formatNum(sku.totalProduction)}</span>
                  </div>
                  <MiniBar value={sku.totalProduction} max={maxForecast} color="#f59e0b" />

                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">IMS (Actual)</span>
                    <span className="font-semibold">{formatNum(sku.totalIms)}</span>
                  </div>
                  <MiniBar value={sku.totalIms} max={maxForecast} color="#3b82f6" />
                </div>

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-b pb-2 mb-2">
                  <div className="text-[10px]">
                    <span className="text-muted-foreground">Stock (MC): </span>
                    <span className={`font-bold ${(sku as any).currentStockMC > 0 ? "text-blue-700" : (sku as any).currentStockMC < 0 ? "text-red-600" : "text-gray-500"}`}>
                      {formatNum((sku as any).currentStockMC ?? 0)}
                    </span>
                  </div>
                  <span className="text-[9px] text-muted-foreground">Current Month</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="text-[10px]">
                    <span className="text-muted-foreground">Forecast Accuracy: </span>
                    <span className={`font-bold ${sku.forecastAccuracy >= 80 ? "text-emerald-600" : sku.forecastAccuracy >= 60 ? "text-amber-600" : "text-red-600"}`}>
                      {sku.forecastAccuracy}%
                    </span>
                  </div>
                  <SparkLine data={sku.monthly.map(m => m.forecast)} color={PALETTE[idx % PALETTE.length]} height={20} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  // ==================== BY WEIGHT TAB ====================
  const ByWeightTab = () => {
    if (loadingWeight || !byWeightData) return <div className="p-4 text-sm text-muted-foreground">Loading weight analysis...</div>;

    const weightColors: Record<string, string> = { "1kg": "#ef4444", "250g": "#f59e0b", "50g": "#3b82f6" };
    const totalForecast = byWeightData.reduce((s, w) => s + w.totalForecast, 0);

    return (
      <div className="space-y-6">
        {/* Weight Distribution Donut */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Forecast Distribution by Weight</CardTitle>
            </CardHeader>
            <CardContent>
              <DonutChart
                segments={byWeightData.map(w => ({
                  label: `${w.weight} (${w.skuCount} SKUs)`,
                  value: w.totalForecast,
                  color: weightColors[w.weight] || "#6b7280",
                }))}
                formatter={formatNum}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Production Distribution by Weight</CardTitle>
            </CardHeader>
            <CardContent>
              <DonutChart
                segments={byWeightData.map(w => ({
                  label: `${w.weight} (${w.skuCount} SKUs)`,
                  value: w.totalProduction,
                  color: weightColors[w.weight] || "#6b7280",
                }))}
                formatter={formatNum}
              />
            </CardContent>
          </Card>
        </div>

        {/* Weight Comparison Bars */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Weight Category Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {byWeightData.map(w => (
                <div key={w.weight} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                      w.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                      w.weight === '250g' ? 'bg-amber-100 text-amber-700' :
                      'bg-rose-100 text-rose-700'
                    }`}>{w.weight}</span>
                    <span className="text-xs text-muted-foreground">{w.skuCount} SKUs</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div>
                      <span className="text-muted-foreground">Forecast</span>
                      <MiniBar value={w.totalForecast} max={totalForecast} color="#10b981" label={formatNum(w.totalForecast)} />
                    </div>
                    <div>
                      <span className="text-muted-foreground">Production</span>
                      <MiniBar value={w.totalProduction} max={totalForecast} color="#f59e0b" label={formatNum(w.totalProduction)} />
                    </div>
                    <div>
                      <span className="text-muted-foreground">IMS</span>
                      <MiniBar value={w.totalIms} max={totalForecast} color="#3b82f6" label={formatNum(w.totalIms)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Monthly Trend by Weight */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly Forecast Trend by Weight</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {byWeightData.map(w => (
                <div key={w.weight}>
                  <p className="text-xs font-semibold mb-1" style={{ color: weightColors[w.weight] }}>{w.weight} Forecast</p>
                  <SparkLine data={w.monthly.map(m => m.forecast)} color={weightColors[w.weight]} height={50} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ==================== BY CATEGORY TAB ====================
  const ByCategoryTab = () => {
    if (loadingCategory || !byCategoryData) return <div className="p-4 text-sm text-muted-foreground">Loading category analysis...</div>;

    const catColors: Record<string, string> = { "Core": "#10b981", "NPI": "#8b5cf6" };

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {byCategoryData.map(cat => (
            <Card key={cat.category}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: catColors[cat.category] }} />
                  <CardTitle className="text-sm">{cat.category}</CardTitle>
                  <span className="text-xs text-muted-foreground ml-auto">{cat.skuCount} SKUs</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-2 bg-muted rounded">
                    <p className="text-lg font-bold text-emerald-600">{formatNum(cat.totalForecast)}</p>
                    <p className="text-[10px] text-muted-foreground">Forecast</p>
                  </div>
                  <div className="text-center p-2 bg-muted rounded">
                    <p className="text-lg font-bold text-amber-600">{formatNum(cat.totalProduction)}</p>
                    <p className="text-[10px] text-muted-foreground">Production</p>
                  </div>
                  <div className="text-center p-2 bg-muted rounded">
                    <p className="text-lg font-bold text-blue-600">{formatNum(cat.totalIms)}</p>
                    <p className="text-[10px] text-muted-foreground">IMS</p>
                  </div>
                </div>

                {/* Weight breakdown within category */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Weight Breakdown</p>
                  <DonutChart
                    segments={cat.weightBreakdown.map(wb => ({
                      label: `${wb.weight} (${wb.count})`,
                      value: wb.forecast,
                      color: wb.weight === "1kg" ? "#ef4444" : wb.weight === "250g" ? "#f59e0b" : "#3b82f6",
                    }))}
                    size={100}
                    formatter={formatNum}
                  />
                </div>

                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Monthly Trend</p>
                  <SparkLine data={cat.monthly.map(m => m.forecast)} color={catColors[cat.category]} height={40} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Side-by-side comparison */}
        {byCategoryData.length >= 2 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Core vs NPI Monthly Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <StackedBarChart
                data={byCategoryData[0].monthly.map((m, idx) => ({
                  label: m.period.slice(0, 3) + "'" + m.period.slice(-2),
                  values: byCategoryData.reduce((acc, cat) => {
                    acc[cat.category] = cat.monthly[idx]?.forecast || 0;
                    return acc;
                  }, {} as Record<string, number>),
                }))}
                keys={byCategoryData.map(c => c.category)}
                colors={catColors}
                labels={byCategoryData.reduce((acc, c) => { acc[c.category] = c.category; return acc; }, {} as Record<string, string>)}
                formatter={formatNum}
              />
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  // ==================== BY FLAVOR TAB ====================
  const ByFlavorTab = () => {
    if (loadingFlavor || !byFlavorData) return <div className="p-4 text-sm text-muted-foreground">Loading flavor analysis...</div>;

    const maxForecast = Math.max(...byFlavorData.map(f => f.totalForecast), 1);

    return (
      <div className="space-y-6">
        {/* Top Flavors Ranking */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Flavor Ranking by Total Forecast</CardTitle>
          </CardHeader>
          <CardContent>
            <HorizontalBarChart
              items={byFlavorData.slice(0, 15).map(f => ({
                label: f.flavor,
                value: f.totalForecast,
                sublabel: f.weights.join(", "),
              }))}
              maxValue={maxForecast}
              colorFn={(idx) => PALETTE[idx % PALETTE.length]}
              formatter={formatNum}
            />
          </CardContent>
        </Card>

        {/* Flavor Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {byFlavorData.map((f, idx) => (
            <Card key={f.flavor} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: PALETTE[idx % PALETTE.length] }} />
              <CardContent className="p-3 pl-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold">{f.flavor}</p>
                    <div className="flex gap-1 mt-1">
                      {f.weights.map(w => (
                        <span key={w} className={`text-[10px] px-1 py-0.5 rounded font-medium ${
                          w === '50g' ? 'bg-blue-100 text-blue-700' :
                          w === '250g' ? 'bg-amber-100 text-amber-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>{w}</span>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-muted-foreground">#{idx + 1}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                  <div className="bg-emerald-50 rounded p-1.5">
                    <p className="text-xs font-bold text-emerald-700">{formatNum(f.totalForecast)}</p>
                    <p className="text-[9px] text-emerald-600">Forecast</p>
                  </div>
                  <div className="bg-blue-50 rounded p-1.5">
                    <p className="text-xs font-bold text-blue-700">{formatNum(f.totalIms)}</p>
                    <p className="text-[9px] text-blue-600">IMS</p>
                  </div>
                  <div className="bg-amber-50 rounded p-1.5">
                    <p className="text-xs font-bold text-amber-700">{formatNum(f.totalProduction)}</p>
                    <p className="text-[9px] text-amber-600">Production</p>
                  </div>
                </div>
                <div className="mt-2 text-[10px] text-muted-foreground">
                  {f.skus.length} variant{f.skus.length > 1 ? "s" : ""}: {f.skus.map(s => s.weight).join(", ")}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  };

  // ==================== PRODUCTION TAB ====================
  const ProductionTab = () => {
    if (loadingProduction || !productionData) return <div className="p-4 text-sm text-muted-foreground">Loading production analysis...</div>;

    const maxShipped = Math.max(...productionData.monthly.map(m => Math.max(m.shipped, m.arrived)), 1);

    return (
      <div className="space-y-6">
        {/* Monthly Shipped vs Arrived */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly: Shipped vs Arrived</CardTitle>
          </CardHeader>
          <CardContent>
            <StackedBarChart
              data={productionData.monthly.map(m => ({
                label: m.period.slice(0, 3) + "'" + m.period.slice(-2),
                values: { shipped: m.shipped, arrived: m.arrived },
              }))}
              keys={["shipped", "arrived"]}
              colors={{ shipped: "#f59e0b", arrived: "#8b5cf6" }}
              labels={{ shipped: "Shipped", arrived: "Arrived" }}
              formatter={formatNum}
            />
          </CardContent>
        </Card>

        {/* Gap Analysis */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Production-Arrival Gap (Shipped - Arrived)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {productionData.monthly.filter(m => m.shipped > 0 || m.arrived > 0).map(m => (
                <div key={m.period} className="flex items-center gap-2">
                  <div className="min-w-[60px] text-[10px] text-muted-foreground text-right">{m.period.slice(0, 3) + "'" + m.period.slice(-2)}</div>
                  <div className="flex-1 h-4 bg-muted rounded overflow-hidden relative flex items-center">
                    {m.gap >= 0 ? (
                      <div className="h-full bg-amber-400 rounded" style={{ width: `${maxShipped > 0 ? Math.abs(m.gap) / maxShipped * 100 : 0}%` }} />
                    ) : (
                      <div className="h-full bg-violet-400 rounded" style={{ width: `${maxShipped > 0 ? Math.abs(m.gap) / maxShipped * 100 : 0}%` }} />
                    )}
                  </div>
                  <span className={`text-[10px] font-semibold min-w-[60px] text-right ${m.gap >= 0 ? "text-amber-600" : "text-violet-600"}`}>
                    {m.gap >= 0 ? "+" : ""}{formatNum(m.gap)}
                  </span>
                  <span className="text-[10px] text-muted-foreground min-w-[35px] text-right">{m.efficiency}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Per-SKU Efficiency Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">SKU Delivery Efficiency (Arrived / Shipped)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted">
                    <th className="px-2 py-1.5 text-left font-medium">SKU</th>
                    <th className="px-2 py-1.5 text-left font-medium">Weight</th>
                    <th className="px-2 py-1.5 text-right font-medium">Shipped</th>
                    <th className="px-2 py-1.5 text-right font-medium">Arrived</th>
                    <th className="px-2 py-1.5 text-right font-medium">Gap</th>
                    <th className="px-2 py-1.5 text-right font-medium">Efficiency</th>
                  </tr>
                </thead>
                <tbody>
                  {productionData.skuEfficiency.filter(s => s.totalShipped > 0).map(s => (
                    <tr key={s.id} className="border-b hover:bg-muted/50">
                      <td className="px-2 py-1.5 font-medium">{s.name}</td>
                      <td className="px-2 py-1.5">
                        <span className={`px-1 py-0.5 rounded text-[10px] font-semibold ${
                          s.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                          s.weight === '250g' ? 'bg-amber-100 text-amber-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>{s.weight}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatNum(s.totalShipped)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatNum(s.totalArrived)}</td>
                      <td className={`px-2 py-1.5 text-right tabular-nums ${s.gap > 0 ? "text-amber-600" : "text-violet-600"}`}>
                        {s.gap >= 0 ? "+" : ""}{formatNum(s.gap)}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className={`font-semibold ${s.efficiency >= 90 ? "text-emerald-600" : s.efficiency >= 70 ? "text-amber-600" : "text-red-600"}`}>
                          {s.efficiency}%
                        </span>
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

  // ==================== STOCK POSITION TAB (merged Stock Health + Stock Levels + Snapshot) ====================
  const StockPositionTab = () => {
    const [slSort, setSlSort] = useState<"weeks" | "stock" | "health" | "name">("weeks");
    const [expandedSku, setExpandedSku] = useState<number | null>(null);
    const [heatmapFilter, setHeatmapFilter] = useState<"all" | "critical" | "overstock">("all");
    const [positionView, setPositionView] = useState<"grid" | "summary" | "alerts">("grid");

    const sd = stockLevelsData as any;
    const snap = stockSnapshot as any;

    const zoneColorMap: Record<string, string> = {
      "Healthy": "#16a34a", "Critical": "#dc2626", "Overstock": "#ea580c",
      "Out of Stock": "#6b7280", "Negative": "#111827",
    };
    const zoneBgMap: Record<string, string> = {
      "Healthy": "#d1fae5", "Critical": "#fee2e2", "Overstock": "#fef3c7",
      "Out of Stock": "#f3f4f6", "Negative": "#e5e7eb",
    };

    const zoneBadge = (zone: string) => {
      const cls: Record<string, string> = {
        "Healthy": "bg-green-100 text-green-700", "Critical": "bg-red-100 text-red-700",
        "Overstock": "bg-orange-100 text-orange-700", "Negative": "bg-gray-900 text-white",
        "Out of Stock": "bg-gray-100 text-gray-600",
      };
      return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cls[zone] || "bg-gray-100 text-gray-600"}`}>{zone}</span>;
    };

    return (
      <div className="space-y-6">
        {/* KPIs */}
        {sd && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard title="Total Closing Stock" value={formatNum(sd.totalClosingStock)} subtitle="Current period" color="#3b82f6" />
            <KpiCard title="Avg Weeks of Stock" value={`${sd.avgWeeksAll}w`} subtitle="Target: 4–6 weeks" color={sd.avgWeeksAll >= 4 && sd.avgWeeksAll <= 6 ? "#10b981" : "#ef4444"} />
            <KpiCard title="Health Score" value={`${sd.avgHealthScore}%`} subtitle="% periods in Healthy zone" color={sd.avgHealthScore >= 50 ? "#10b981" : "#ef4444"} />
            <KpiCard title="Total SKUs" value={String(sd.totalSkus)} color="#8b5cf6" />
          </div>
        )}

        {/* Sub-navigation */}
        <div className="flex gap-2 items-center border-b pb-2">
          <span className="text-xs text-muted-foreground">View:</span>
          {(["grid", "summary", "alerts"] as const).map(v => (
            <button key={v} onClick={() => setPositionView(v)} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${positionView === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {v === "grid" ? "Closing Stock Grid" : v === "summary" ? "SKU Summary" : "Alerts & Heatmap"}
            </button>
          ))}
        </div>

        {/* VIEW: Closing Stock Grid */}
        {positionView === "grid" && loadingStockLvl && <div className="p-4 text-sm text-muted-foreground">Loading closing stock grid...</div>}
        {positionView === "grid" && !loadingStockLvl && sd && (() => {
          const periodLabels: string[] = sd.periodLabels ?? [];
          const shortPLabels = periodLabels.map((l: string) => l.length > 5 ? l.slice(0, 3) + "'" + l.slice(-2) : l);
          const skus: any[] = sd.skuStocks ?? [];
          const totalByPeriod: number[] = periodLabels.map((_: string, pIdx: number) =>
            skus.reduce((sum: number, sk: any) => sum + (sk.closingStocks?.[pIdx] ?? 0), 0)
          );
          const wosColor = (w: number) => {
            if (Math.abs(w) >= 99) return w > 0 ? "#ea580c" : "#111827";
            if (w <= 0) return "#6b7280";
            if (w < 4) return "#dc2626";
            if (w <= 6) return "#16a34a";
            return "#ea580c";
          };
          const fmtCS = (v: number) => v === 0 ? "—" : v.toLocaleString();

          return (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Closing Stock by Period (per SKU)</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">Same data as Planning FG &quot;Closing Stock&quot; row. Color = weeks-of-stock zone (green 4-6w, red &lt;4w, orange &gt;6w)</p>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead className="sticky top-0 z-10">
                        <tr className="bg-muted">
                          <th className="text-left p-2 font-semibold sticky left-0 bg-muted min-w-[160px] border-b border-r">SKU</th>
                          <th className="text-center p-1.5 font-semibold border-b min-w-[50px]">Wt</th>
                          {shortPLabels.map((l: string, i: number) => (
                            <th key={i} className="text-right p-1.5 font-medium border-b min-w-[70px]">{l}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {skus.map((sku: any) => (
                          <tr key={sku.id} className="border-b hover:bg-muted/30 transition-colors">
                            <td className="p-2 font-medium sticky left-0 bg-white border-r whitespace-nowrap">{sku.name}</td>
                            <td className="text-center p-1.5">
                              <span className={`px-1 py-0.5 rounded text-[10px] font-semibold ${sku.weight === '50g' ? 'bg-blue-100 text-blue-700' : sku.weight === '250g' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{sku.weight}</span>
                            </td>
                            {(sku.closingStocks as number[]).map((cs: number, pIdx: number) => {
                              const wos = sku.weeksOfStock?.[pIdx] ?? 0;
                              const bgColor = wosColor(wos);
                              return (
                                <td key={pIdx} className="text-right p-1.5 font-mono" style={{ backgroundColor: `${bgColor}12` }}>
                                  <div className="leading-tight">
                                    <span style={{ color: bgColor }} className="font-semibold">{fmtCS(cs)}</span>
                                    <div className="text-[9px] opacity-60">{Math.abs(wos) >= 99 ? (wos > 0 ? "∞w" : "-∞w") : `${wos}w`}</div>
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        <tr className="bg-muted/70 font-bold border-t-2">
                          <td className="p-2 sticky left-0 bg-muted/70 border-r">TOTAL</td>
                          <td className="p-1.5"></td>
                          {totalByPeriod.map((total: number, pIdx: number) => (
                            <td key={pIdx} className="text-right p-1.5 font-mono font-bold">{total === 0 ? "—" : total.toLocaleString()}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Zone Distribution + Zone Trend */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Current Zone Distribution</CardTitle></CardHeader>
                  <CardContent>
                    <DonutChart segments={(sd.zoneDistribution as any[]).map((z: any) => ({ label: `${z.zone} (${z.count})`, value: z.count, color: z.color }))} size={140} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Zone Trend Over Time</CardTitle></CardHeader>
                  <CardContent>
                    <StackedBarChart
                      data={(sd.periodZones as any[]).map((pz: any, i: number) => ({
                        label: shortPLabels[i] || pz.period,
                        values: pz.zones,
                      }))}
                      keys={["Healthy", "Critical", "Overstock", "Out of Stock", "Negative"]}
                      colors={zoneColorMap}
                      labels={{ "Healthy": "Healthy", "Critical": "Critical", "Overstock": "Overstock", "Out of Stock": "Out of Stock", "Negative": "Negative" }}
                    />
                  </CardContent>
                </Card>
              </div>
            </>
          );
        })()}

        {/* VIEW: SKU Summary */}
        {positionView === "summary" && loadingStockLvl && <div className="p-4 text-sm text-muted-foreground">Loading SKU summary...</div>}
        {positionView === "summary" && !loadingStockLvl && sd && (() => {
          const sortedSkus = [...(sd.skuStocks as any[])].sort((a: any, b: any) => {
            if (slSort === "weeks") return a.currentWeeks - b.currentWeeks;
            if (slSort === "stock") return b.currentClosingStock - a.currentClosingStock;
            if (slSort === "health") return a.healthScore - b.healthScore;
            return a.name.localeCompare(b.name);
          });
          return (
            <>
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
                            <td className="text-center p-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${sku.weight === "50g" ? "bg-blue-100 text-blue-700" : sku.weight === "250g" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{sku.weight}</span>
                            </td>
                            <td className="text-center p-2">{zoneBadge(sku.currentZone)}</td>
                            <td className="text-right p-2 font-semibold">{formatNum(sku.currentClosingStock)}</td>
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

              {/* Stock by Weight */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Stock by Weight</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(sd.weightStockSummary as any[]).map((ws: any) => (
                      <div key={ws.weight} className="border rounded-lg p-3">
                        <span className={`px-2 py-1 rounded text-sm font-bold ${ws.weight === "50g" ? "bg-blue-100 text-blue-700" : ws.weight === "250g" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{ws.weight}</span>
                        <div className="mt-2 space-y-1 text-xs">
                          <div className="flex justify-between"><span className="text-muted-foreground">Total Stock</span><span className="font-semibold">{formatNum(ws.totalStock)}</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">Avg Weeks</span><span className="font-semibold">{ws.avgWeeks}w</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">SKUs</span><span className="font-semibold">{ws.skuCount}</span></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          );
        })()}

        {/* VIEW: Alerts & Heatmap */}
        {positionView === "alerts" && loadingSnapshot && <div className="p-4 text-sm text-muted-foreground">Loading alerts...</div>}
        {positionView === "alerts" && !loadingSnapshot && snap && (() => {
          const { summary, criticalSkus, overstockedSkus, heatmap, periodLabels, actionSummary } = snap;
          const trendIcon = (t: string) => t === "improving" ? "↑" : t === "deteriorating" ? "↓" : "→";
          const trendColor = (t: string) => t === "improving" ? "text-emerald-600" : t === "deteriorating" ? "text-red-600" : "text-muted-foreground";
          const filteredHeatmap = heatmapFilter === "critical"
            ? heatmap.filter((r: any) => r.periods.some((p: any) => p.zone === "Critical" || p.zone === "Negative" || p.zone === "Out of Stock"))
            : heatmapFilter === "overstock"
            ? heatmap.filter((r: any) => r.periods.some((p: any) => p.zone === "Overstock"))
            : heatmap;
          const healthPct = summary.total > 0 ? Math.round(summary.healthy / summary.total * 100) : 0;

          return (
            <>
              {/* Risk tier cards */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <Card className="border-red-200 bg-red-50">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-red-600 uppercase tracking-wider">Critical</p>
                    <p className="text-3xl font-bold text-red-600 mt-1">{summary.critical}</p>
                    <p className="text-xs text-red-500 mt-0.5">SKUs below 4w stock</p>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-amber-600 uppercase tracking-wider">Overstock</p>
                    <p className="text-3xl font-bold text-amber-600 mt-1">{summary.overstock}</p>
                    <p className="text-xs text-amber-500 mt-0.5">SKUs above 6w stock</p>
                  </CardContent>
                </Card>
                <Card className="border-orange-200 bg-orange-50">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-orange-600 uppercase tracking-wider">At Risk</p>
                    <p className="text-3xl font-bold text-orange-600 mt-1">{summary.warning}</p>
                    <p className="text-xs text-orange-500 mt-0.5">Healthy now, critical ahead</p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-emerald-600 uppercase tracking-wider">Healthy</p>
                    <p className="text-3xl font-bold text-emerald-600 mt-1">{summary.healthy}</p>
                    <p className="text-xs text-emerald-500 mt-0.5">4–6 weeks, no issues</p>
                  </CardContent>
                </Card>
                <Card className="border-blue-200 bg-blue-50">
                  <CardContent className="p-4">
                    <p className="text-xs font-medium text-blue-600 uppercase tracking-wider">Health Rate</p>
                    <p className="text-3xl font-bold text-blue-600 mt-1">{healthPct}%</p>
                    <p className="text-xs text-blue-500 mt-0.5">of {summary.total} total SKUs</p>
                  </CardContent>
                </Card>
              </div>

              {/* Recommended Actions */}
              <Card className="border-slate-200">
                <CardHeader className="pb-2"><CardTitle className="text-sm">Recommended Actions</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-start gap-3 p-3 bg-red-50 rounded-lg border border-red-100">
                      <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold text-sm flex-shrink-0">{actionSummary.needProductionIncrease}</div>
                      <div>
                        <p className="text-xs font-semibold text-red-700">Increase Production</p>
                        <p className="text-[11px] text-red-600 mt-0.5">SKUs with insufficient shipment vs forecast</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-bold text-sm flex-shrink-0">{actionSummary.needForecastReduction}</div>
                      <div>
                        <p className="text-xs font-semibold text-amber-700">Reduce Forecast</p>
                        <p className="text-[11px] text-amber-600 mt-0.5">Overstocked SKUs with excess forecast</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 bg-violet-50 rounded-lg border border-violet-100">
                      <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 font-bold text-sm flex-shrink-0">{actionSummary.needBoth}</div>
                      <div>
                        <p className="text-xs font-semibold text-violet-700">Mixed Strategy</p>
                        <p className="text-[11px] text-violet-600 mt-0.5">SKUs needing both adjustments</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Critical SKUs */}
              {criticalSkus.length > 0 && (
                <Card className="border-red-200">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm text-red-700">Critical SKUs</CardTitle>
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">{criticalSkus.length}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {criticalSkus.map((sku: any) => (
                        <div key={sku.id} className="border border-red-100 rounded-lg overflow-hidden">
                          <button className="w-full flex items-center justify-between p-3 bg-red-50 hover:bg-red-100 transition-colors text-left" onClick={() => setExpandedSku(expandedSku === sku.id ? null : sku.id)}>
                            <div className="flex items-center gap-3">
                              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: zoneColorMap[sku.currentZone] }} />
                              <span className="text-xs font-semibold">{sku.name}</span>
                              <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${sku.weight === '50g' ? 'bg-blue-100 text-blue-700' : sku.weight === '250g' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{sku.weight}</span>
                            </div>
                            <div className="flex items-center gap-4">
                              <span className="text-xs font-bold" style={{ color: zoneColorMap[sku.currentZone] }}>{sku.currentWeeks}w</span>
                              <span className={`text-sm font-bold ${trendColor(sku.trend)}`}>{trendIcon(sku.trend)}</span>
                              <span className="text-[10px] text-muted-foreground">{expandedSku === sku.id ? "▲" : "▼"}</span>
                            </div>
                          </button>
                          {expandedSku === sku.id && (
                            <div className="p-3 bg-white border-t border-red-100">
                              <div className="overflow-x-auto">
                                <div className="flex gap-1 min-w-max">
                                  {sku.periodWeeks.map((pw: any) => (
                                    <div key={pw.label} className="text-center min-w-[52px]">
                                      <div className="text-[9px] text-muted-foreground mb-1">{pw.label}</div>
                                      <div className="rounded py-1 px-1 text-[10px] font-bold" style={{ backgroundColor: zoneBgMap[pw.zone], color: zoneColorMap[pw.zone] }}>
                                        {pw.weeks > 0 ? `${pw.weeks}w` : "0w"}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Overstocked SKUs */}
              {overstockedSkus.length > 0 && (
                <Card className="border-amber-200">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm text-amber-700">Overstocked SKUs</CardTitle>
                      <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{overstockedSkus.length}</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {overstockedSkus.map((sku: any) => (
                        <div key={sku.id} className="flex items-center justify-between p-2.5 bg-amber-50 rounded-lg border border-amber-100">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{sku.name}</span>
                            <span className={`text-[10px] px-1 py-0.5 rounded font-medium ${sku.weight === '50g' ? 'bg-blue-100 text-blue-700' : sku.weight === '250g' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{sku.weight}</span>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-xs font-bold text-amber-600">{sku.currentWeeks}w</span>
                            <span className={`text-xs ${trendColor(sku.trend)}`}>{trendIcon(sku.trend)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Health Heatmap */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-sm">Stock Health Heatmap</CardTitle>
                    <div className="flex gap-1">
                      {(["all", "critical", "overstock"] as const).map(f => (
                        <button key={f} onClick={() => setHeatmapFilter(f)} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${heatmapFilter === f ? f === "critical" ? "bg-red-500 text-white border-red-500" : f === "overstock" ? "bg-amber-500 text-white border-amber-500" : "bg-slate-700 text-white border-slate-700" : "bg-background border-border text-muted-foreground hover:bg-muted"}`}>
                          {f === "all" ? "All" : f === "critical" ? "Critical" : "Overstock"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3 mt-2 flex-wrap">
                    {Object.entries(zoneBgMap).map(([zone, bg]) => (
                      <div key={zone} className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-sm border" style={{ backgroundColor: bg, borderColor: zoneColorMap[zone] }} />
                        <span className="text-[10px] text-muted-foreground">{zone}</span>
                      </div>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  {filteredHeatmap.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center">No SKUs match the selected filter.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="text-[10px] border-collapse w-full">
                        <thead>
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground sticky left-0 bg-background z-10 min-w-[140px] border-b">SKU</th>
                            <th className="px-1 py-1.5 text-center font-medium text-muted-foreground min-w-[28px] border-b">Wt</th>
                            {periodLabels.map((label: string) => (
                              <th key={label} className="px-1 py-1.5 text-center font-medium text-muted-foreground min-w-[44px] border-b">{label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredHeatmap.map((row: any, rowIdx: number) => (
                            <tr key={row.skuId} className={rowIdx % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                              <td className="px-2 py-1 font-medium sticky left-0 z-10 border-b" style={{ backgroundColor: rowIdx % 2 === 0 ? "white" : "#f8fafc" }}>{row.skuName}</td>
                              <td className="px-1 py-1 text-center border-b">
                                <span className={`text-[9px] px-1 rounded font-medium ${row.weight === '50g' ? 'bg-blue-100 text-blue-700' : row.weight === '250g' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{row.weight}</span>
                              </td>
                              {row.periods.map((pw: any) => (
                                <td key={pw.label} className="px-1 py-1 text-center border-b font-semibold" style={{ backgroundColor: zoneBgMap[pw.zone] || "#f9fafb", color: zoneColorMap[pw.zone] || "#374151" }} title={`${row.skuName} - ${pw.label}: ${pw.weeks}w (${pw.zone})`}>
                                  {pw.weeks > 0 ? pw.weeks : "-"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          );
        })()}
      </div>
    );
  };

  const RunningRateTab = () => {
    const [rrView, setRrView] = useState<"sku" | "flavor" | "weight">("sku");
    const [rrSort, setRrSort] = useState<"avg3m" | "trend" | "name">("avg3m");
    if (loadingRunRate) return <div className="p-4 text-sm text-muted-foreground">Loading running rate...</div>;
    if (!runningRateData) return <div className="p-4 text-sm text-muted-foreground">No IMS data available for running rate analysis.</div>;
    const rd = runningRateData as any;
    const shortLabels = (rd.periodLabels as string[]).map((l: string) => l.length > 5 ? l.slice(0, 3) + "'" + l.slice(-2) : l);

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
          <KpiCard title="Total IMS" value={formatNum(rd.totalIms)} color="#3b82f6" />
          <KpiCard title="Avg 3M Running Rate" value={formatNum(rd.totalAvg3m)} subtitle="Monthly avg (last 3 months)" color="#10b981" />
          <KpiCard title="Overall Trend" value={`${rd.overallTrend >= 0 ? "+" : ""}${rd.overallTrend}%`} subtitle="3M vs prior 3M" color={rd.overallTrend >= 0 ? "#10b981" : "#ef4444"} />
          <KpiCard title="Active SKUs" value={String(rd.totalSkus)} color="#8b5cf6" />
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Monthly IMS Running Rate — Total Market</CardTitle>
          </CardHeader>
          <CardContent>
            <SparkLine data={rd.monthlyTotals} color="#3b82f6" height={60} />
            <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
              {shortLabels.filter((_: string, i: number) => i % Math.max(1, Math.floor(shortLabels.length / 8)) === 0).map((l: string, i: number) => (
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
                        <td className="text-center p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${sku.weight === "50g" ? "bg-blue-100 text-blue-700" : sku.weight === "250g" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{sku.weight}</span>
                        </td>
                        <td className="text-right p-2 font-semibold">{formatNum(sku.avg3m)}</td>
                        <td className="text-right p-2">{formatNum(sku.avg6m)}</td>
                        <td className="text-right p-2">{formatNum(sku.avgAll)}</td>
                        <td className="text-right p-2">{formatNum(sku.lastMonthValue)}</td>
                        <td className="text-center p-2">{trendBadge(sku.trendDirection, Math.abs(sku.trend))}</td>
                        <td className="text-center p-2">
                          <div className="text-[10px]">{formatNum(sku.peakValue)}</div>
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
                    <div>
                      <p className="text-muted-foreground">Total IMS</p>
                      <p className="font-semibold">{formatNum(f.totalIms)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">3M Avg</p>
                      <p className="font-semibold">{formatNum(f.avg3m)}</p>
                    </div>
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
                    <span className={`px-2 py-1 rounded text-sm font-bold ${w.weight === "50g" ? "bg-blue-100 text-blue-700" : w.weight === "250g" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>{w.weight}</span>
                    {trendBadge(w.trend > 5 ? "growing" : w.trend < -5 ? "declining" : "stable", Math.abs(w.trend))}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Total IMS</span><span className="font-semibold">{formatNum(w.totalIms)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">3M Running Rate</span><span className="font-semibold">{formatNum(w.avg3m)}</span></div>
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

  // ==================== BREAKDOWNS TAB (merged Weight + Category + Flavor) ====================
  const BreakdownsTab = () => {
    const [breakdownView, setBreakdownView] = useState<"weight" | "category" | "flavor">("weight");

    return (
      <div className="space-y-6">
        <div className="flex gap-2 items-center border-b pb-2">
          <span className="text-xs text-muted-foreground">View:</span>
          {(["weight", "category", "flavor"] as const).map(v => (
            <button key={v} onClick={() => setBreakdownView(v)} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${breakdownView === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {v === "weight" ? "By Weight" : v === "category" ? "By Category" : "By Flavor"}
            </button>
          ))}
        </div>

        {breakdownView === "weight" && <ByWeightTab />}
        {breakdownView === "category" && <ByCategoryTab />}
        {breakdownView === "flavor" && <ByFlavorTab />}
      </div>
    );
  };

  // ==================== PRODUCTION & IMS TAB (merged Production + Running Rate) ====================
  const ProductionImsTab = () => {
    const [prodView, setProdView] = useState<"production" | "runningrate">("production");

    return (
      <div className="space-y-6">
        <div className="flex gap-2 items-center border-b pb-2">
          <span className="text-xs text-muted-foreground">View:</span>
          {(["production", "runningrate"] as const).map(v => (
            <button key={v} onClick={() => setProdView(v)} className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${prodView === v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {v === "production" ? "Shipped & Arrived" : "IMS Running Rate"}
            </button>
          ))}
        </div>

        {prodView === "production" && <ProductionTab />}
        {prodView === "runningrate" && <RunningRateTab />}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analysis Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Demand planning analytics — Lebanon market
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 shrink-0 border-emerald-600 text-emerald-700 hover:bg-emerald-50"
          onClick={handleExport}
          disabled={isExporting}
        >
          {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          <span>Export to Excel</span>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex flex-wrap h-auto gap-1 bg-muted p-1 rounded-lg">
          <TabsTrigger value="overview" className="text-xs tab-dark-red">Overview</TabsTrigger>
          <TabsTrigger value="stockposition" className="text-xs tab-dark-red">Stock Position</TabsTrigger>
          <TabsTrigger value="sku" className="text-xs tab-dark-red">By SKU</TabsTrigger>
          <TabsTrigger value="breakdowns" className="text-xs tab-dark-red">Breakdowns</TabsTrigger>
          <TabsTrigger value="production" className="text-xs tab-dark-red">Production & IMS</TabsTrigger>
        </TabsList>

        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="stockposition"><StockPositionTab /></TabsContent>
        <TabsContent value="sku"><BySkuTab /></TabsContent>
        <TabsContent value="breakdowns"><BreakdownsTab /></TabsContent>
        <TabsContent value="production"><ProductionImsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
