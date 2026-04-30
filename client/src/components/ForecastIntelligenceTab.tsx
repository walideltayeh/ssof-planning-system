import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, ArrowUpRight, ArrowDownRight, Target, BarChart3, Layers, Filter } from "lucide-react";

const ZONE_COLORS: Record<string, string> = {
  "Critical": "#dc2626",
  "Negative": "#111827",
  "Out of Stock": "#6b7280",
  "Healthy": "#16a34a",
  "Overstock": "#ea580c",
};

const TREND_ICONS: Record<string, any> = {
  growing: TrendingUp,
  declining: TrendingDown,
  stable: Minus,
};

function ForecastIntelligenceTab({ country }: { country: "Lebanon" | "Syria" | "Libya" | "KSA" }) {
  const [subView, setSubView] = useState<"summary" | "skuTable" | "gapAnalysis">("summary");
  const [weightFilter, setWeightFilter] = useState<string>("all");
  const [trendFilter, setTrendFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("recommendedForecast");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const { data, isLoading, isError, error } = trpc.country.forecastIntelligence.useQuery({ country });

  const filteredSkus = useMemo(() => {
    if (!data) return [];
    let skus = [...data.skuIntel];
    if (weightFilter !== "all") skus = skus.filter(s => s.weight === weightFilter);
    if (trendFilter !== "all") skus = skus.filter(s => s.trendDirection === trendFilter);
    skus.sort((a: any, b: any) => {
      const av = a[sortField] ?? 0;
      const bv = b[sortField] ?? 0;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return skus;
  }, [data, weightFilter, trendFilter, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Computing forecast intelligence...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-10">
        <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600">Failed to load forecast intelligence</p>
        <p className="text-xs text-muted-foreground mt-1">{error?.message || "Unknown error"}</p>
      </div>
    );
  }

  if (!data) {
    return <p className="text-center text-muted-foreground py-10">No data available for forecast intelligence.</p>;
  }

  const { summary, targetMonth, targetYear, weightBreakdown, flavorBreakdown } = data;

  const SummaryView = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
          <CardContent className="p-4 pl-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Target Period</p>
            <p className="text-xl font-bold mt-1 text-blue-600">{targetMonth} {targetYear}</p>
            <p className="text-xs text-muted-foreground">{summary.skuCount} SKUs analyzed</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
          <CardContent className="p-4 pl-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Current Forecast</p>
            <p className="text-xl font-bold mt-1 text-amber-600">{summary.totalCurrentForecast.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Mastercases planned</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
          <CardContent className="p-4 pl-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Recommended</p>
            <p className="text-xl font-bold mt-1 text-emerald-600">{summary.totalRecommended.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground">Based on IMS + factors</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className={`absolute top-0 left-0 w-1 h-full ${summary.totalGap > 0 ? 'bg-red-500' : summary.totalGap < 0 ? 'bg-orange-500' : 'bg-green-500'}`} />
          <CardContent className="p-4 pl-5">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Gap</p>
            <p className={`text-xl font-bold mt-1 ${summary.totalGap > 0 ? 'text-red-600' : summary.totalGap < 0 ? 'text-orange-600' : 'text-green-600'}`}>
              {summary.totalGap > 0 ? "+" : ""}{summary.totalGap.toLocaleString()} ({summary.totalGapPercent > 0 ? "+" : ""}{summary.totalGapPercent}%)
            </p>
            <p className="text-xs text-muted-foreground">{summary.totalGap > 0 ? "Under-forecasted" : summary.totalGap < 0 ? "Over-forecasted" : "Aligned"}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-50"><AlertTriangle className="h-5 w-5 text-red-500" /></div>
            <div>
              <p className="text-sm font-semibold">{summary.criticalSkus}</p>
              <p className="text-xs text-muted-foreground">Critical Stock SKUs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-orange-50"><Layers className="h-5 w-5 text-orange-500" /></div>
            <div>
              <p className="text-sm font-semibold">{summary.overstockedSkus}</p>
              <p className="text-xs text-muted-foreground">Overstocked SKUs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50"><TrendingUp className="h-5 w-5 text-green-500" /></div>
            <div>
              <p className="text-sm font-semibold">{summary.growingSkus}</p>
              <p className="text-xs text-muted-foreground">Growing SKUs</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50"><TrendingDown className="h-5 w-5 text-blue-500" /></div>
            <div>
              <p className="text-sm font-semibold">{summary.decliningSkus}</p>
              <p className="text-xs text-muted-foreground">Declining SKUs</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">By Weight Class</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {weightBreakdown.map(w => {
                const gap = w.recommended - w.currentForecast;
                return (
                  <div key={w.weight} className="flex items-center justify-between p-2 rounded bg-muted/50">
                    <div>
                      <span className="font-medium text-sm">{w.weight}</span>
                      <span className="text-xs text-muted-foreground ml-2">({w.skuCount} SKUs)</span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">Current: {w.currentForecast.toLocaleString()}</span>
                      <span className="font-medium">Rec: {w.recommended.toLocaleString()}</span>
                      <span className={`font-semibold ${gap > 0 ? 'text-red-600' : gap < 0 ? 'text-orange-600' : 'text-green-600'}`}>
                        {gap > 0 ? "+" : ""}{gap.toLocaleString()}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Top Flavors by Recommended Share</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {flavorBreakdown.slice(0, 15).map(f => (
                <div key={f.flavor} className="flex items-center gap-2">
                  <div className="w-24 text-xs font-medium truncate" title={f.flavor}>{f.flavor}</div>
                  <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all"
                      style={{ width: `${Math.min((f.sharePercent / (flavorBreakdown[0]?.sharePercent || 1)) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="w-16 text-right text-xs font-semibold">{f.sharePercent}%</div>
                  <div className="w-20 text-right text-xs text-muted-foreground">{f.recommended.toLocaleString()} MC</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-500" />
            SKUs Requiring Attention
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {data.skuIntel
              .filter(s => Math.abs(s.gapPercent) > 20 || s.stockZone === "Critical" || s.stockZone === "Out of Stock")
              .slice(0, 10)
              .map(s => (
                <div key={s.id} className="flex items-center justify-between p-2 rounded border border-muted">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium">{s.name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.weight === "1kg" ? "bg-red-50 text-red-700" : s.weight === "250g" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                        {s.weight}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${(s as any).packagingType === "Old" ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700"}`}>
                        {(s as any).packagingType ?? "New"} Pkg
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: ZONE_COLORS[s.stockZone] + "15", color: ZONE_COLORS[s.stockZone] }}>
                        {s.stockZone}
                      </span>
                      <span className="text-xs text-muted-foreground">{s.reasoning}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm">
                      <span className="text-muted-foreground">{s.currentForecast.toLocaleString()}</span>
                      <span className="mx-1">→</span>
                      <span className="font-semibold">{s.recommendedForecast.toLocaleString()}</span>
                    </div>
                    <span className={`text-xs font-medium ${s.gap > 0 ? 'text-red-600' : s.gap < 0 ? 'text-orange-600' : 'text-green-600'}`}>
                      {s.gap > 0 ? "+" : ""}{s.gap.toLocaleString()} ({s.gapPercent > 0 ? "+" : ""}{s.gapPercent}%)
                    </span>
                  </div>
                </div>
              ))}
            {data.skuIntel.filter(s => Math.abs(s.gapPercent) > 20 || s.stockZone === "Critical" || s.stockZone === "Out of Stock").length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">All SKUs are within acceptable range</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );

  const SkuTableView = () => {
    const uniqueWeights = [...new Set(data.skuIntel.map(s => s.weight))].sort();
    const SortHeader = ({ field, label }: { field: string; label: string }) => (
      <th
        className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap"
        onClick={() => toggleSort(field)}
      >
        {label} {sortField === field ? (sortDir === "desc" ? "↓" : "↑") : ""}
      </th>
    );

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              className="text-xs border rounded px-2 py-1"
              value={weightFilter}
              onChange={e => setWeightFilter(e.target.value)}
            >
              <option value="all">All Weights</option>
              {uniqueWeights.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <select
            className="text-xs border rounded px-2 py-1"
            value={trendFilter}
            onChange={e => setTrendFilter(e.target.value)}
          >
            <option value="all">All Trends</option>
            <option value="growing">Growing</option>
            <option value="stable">Stable</option>
            <option value="declining">Declining</option>
          </select>
          <span className="text-xs text-muted-foreground ml-auto">{filteredSkus.length} SKUs shown</span>
        </div>

        <div className="overflow-x-auto rounded border">
          <table className="w-full text-xs">
            <thead className="bg-muted/70">
              <tr>
                <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground">SKU</th>
                <SortHeader field="avg3m" label="3M Avg" />
                <SortHeader field="avg6m" label="6M Avg" />
                <SortHeader field="trend" label="Trend" />
                <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground">Season</th>
                <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground">Stock</th>
                <SortHeader field="currentForecast" label="Current FC" />
                <SortHeader field="recommendedForecast" label="Recommended" />
                <SortHeader field="gap" label="Gap" />
                <SortHeader field="sharePercent" label="Share %" />
                <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground">Key Factor</th>
              </tr>
            </thead>
            <tbody>
              {filteredSkus.map((s, i) => {
                const TrendIcon = TREND_ICONS[s.trendDirection] || Minus;
                const autoFilled = (s as any).hasAutoFilledFutureIms === true;
                return (
                  <tr key={s.id} className={i % 2 === 0 ? "bg-white" : "bg-muted/20"}>
                    <td className="px-2 py-1.5 font-medium max-w-[180px] truncate" title={autoFilled ? `${s.name} — future IMS auto-filled from recommended forecast` : s.name}>
                      <span className="flex items-center gap-1">
                        <span className="truncate">{s.name}</span>
                        {autoFilled && (
                          <span
                            className="inline-flex items-center px-1 py-0 rounded-sm text-[8px] font-semibold bg-violet-100 text-violet-700 border border-violet-200 leading-tight"
                            title="Future IMS auto-filled from recommended forecast"
                          >
                            AUTO
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{s.avg3m.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right">{s.avg6m.toLocaleString()}</td>
                    <td className="px-2 py-1.5">
                      <span className={`inline-flex items-center gap-1 ${s.trendDirection === "growing" ? "text-green-600" : s.trendDirection === "declining" ? "text-red-600" : "text-gray-500"}`}>
                        <TrendIcon className="h-3 w-3" />
                        {s.trend > 0 ? "+" : ""}{s.trend}%
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{s.seasonalityIndex.toFixed(2)}x</td>
                    <td className="px-2 py-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: (ZONE_COLORS[s.stockZone] || "#888") + "15", color: ZONE_COLORS[s.stockZone] || "#888" }}>
                        {s.stockZone}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right">{s.currentForecast.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{s.recommendedForecast.toLocaleString()}</td>
                    <td className={`px-2 py-1.5 text-right font-medium ${s.gap > 0 ? 'text-red-600' : s.gap < 0 ? 'text-orange-600' : 'text-green-600'}`}>
                      {s.gap > 0 ? "+" : ""}{s.gap.toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5 text-right">{s.sharePercent}%</td>
                    <td className="px-2 py-1.5 text-muted-foreground max-w-[200px] truncate" title={s.reasoning}>{s.reasoning}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const GapAnalysisView = () => {
    const overForecasted = data.skuIntel.filter(s => s.gap < -5).sort((a, b) => a.gap - b.gap);
    const underForecasted = data.skuIntel.filter(s => s.gap > 5).sort((a, b) => b.gap - a.gap);
    const aligned = data.skuIntel.filter(s => Math.abs(s.gap) <= 5);
    const maxAbsGap = Math.max(...data.skuIntel.map(s => Math.abs(s.gap)), 1);

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <Card className="border-red-200">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Under-Forecasted</p>
              <p className="text-2xl font-bold text-red-600">{underForecasted.length}</p>
              <p className="text-xs text-muted-foreground">Need more supply</p>
            </CardContent>
          </Card>
          <Card className="border-green-200">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Aligned</p>
              <p className="text-2xl font-bold text-green-600">{aligned.length}</p>
              <p className="text-xs text-muted-foreground">Within ±5 MC</p>
            </CardContent>
          </Card>
          <Card className="border-orange-200">
            <CardContent className="p-4 text-center">
              <p className="text-xs text-muted-foreground">Over-Forecasted</p>
              <p className="text-2xl font-bold text-orange-600">{overForecasted.length}</p>
              <p className="text-xs text-muted-foreground">Excess allocation</p>
            </CardContent>
          </Card>
        </div>

        {underForecasted.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-red-600">
                <ArrowUpRight className="h-4 w-4" />
                Under-Forecasted — Increase Allocation ({underForecasted.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-72 overflow-y-auto">
              {underForecasted.map(s => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <div className="w-44 truncate font-medium" title={s.name}>{s.name}</div>
                  <div className="flex-1 relative h-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-red-400 rounded-full" style={{ width: `${(s.gap / maxAbsGap) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="w-20 text-right font-semibold text-red-600">+{s.gap.toLocaleString()}</div>
                  <div className="w-16 text-right text-muted-foreground">({s.currentForecast}→{s.recommendedForecast})</div>
                  <div className="w-28 text-right text-muted-foreground truncate" title={s.reasoning}>{s.reasoning}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {overForecasted.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 text-orange-600">
                <ArrowDownRight className="h-4 w-4" />
                Over-Forecasted — Reduce Allocation ({overForecasted.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 max-h-72 overflow-y-auto">
              {overForecasted.map(s => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <div className="w-44 truncate font-medium" title={s.name}>{s.name}</div>
                  <div className="flex-1 relative h-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(Math.abs(s.gap) / maxAbsGap) * 100}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="w-20 text-right font-semibold text-orange-600">{s.gap.toLocaleString()}</div>
                  <div className="w-16 text-right text-muted-foreground">({s.currentForecast}→{s.recommendedForecast})</div>
                  <div className="w-28 text-right text-muted-foreground truncate" title={s.reasoning}>{s.reasoning}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Recommendation Factor Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-blue-50 rounded-lg">
                <BarChart3 className="h-4 w-4 text-blue-600 mb-1" />
                <p className="font-semibold text-blue-700">Running Rate (Base)</p>
                <p className="text-blue-600">3-month IMS average as baseline demand signal</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <Target className="h-4 w-4 text-purple-600 mb-1" />
                <p className="font-semibold text-purple-700">Seasonality Index</p>
                <p className="text-purple-600">Historical same-month performance vs. overall average</p>
              </div>
              <div className="p-3 bg-amber-50 rounded-lg">
                <Layers className="h-4 w-4 text-amber-600 mb-1" />
                <p className="font-semibold text-amber-700">Stock Health</p>
                <p className="text-amber-600">+15% for critical stock, -10% for overstock</p>
              </div>
              <div className="p-3 bg-emerald-50 rounded-lg">
                <TrendingUp className="h-4 w-4 text-emerald-600 mb-1" />
                <p className="font-semibold text-emerald-700">Trend Momentum</p>
                <p className="text-emerald-600">Adjusts ±15% based on 3M vs prior 3M growth</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant={subView === "summary" ? "default" : "outline"}
          size="sm"
          className={`text-xs ${subView === "summary" ? "bg-[#8B0000] hover:bg-[#6B0000]" : ""}`}
          onClick={() => setSubView("summary")}
        >
          Summary
        </Button>
        <Button
          variant={subView === "skuTable" ? "default" : "outline"}
          size="sm"
          className={`text-xs ${subView === "skuTable" ? "bg-[#8B0000] hover:bg-[#6B0000]" : ""}`}
          onClick={() => setSubView("skuTable")}
        >
          SKU Detail Table
        </Button>
        <Button
          variant={subView === "gapAnalysis" ? "default" : "outline"}
          size="sm"
          className={`text-xs ${subView === "gapAnalysis" ? "bg-[#8B0000] hover:bg-[#6B0000]" : ""}`}
          onClick={() => setSubView("gapAnalysis")}
        >
          Gap Analysis
        </Button>
      </div>

      {subView === "summary" && <SummaryView />}
      {subView === "skuTable" && <SkuTableView />}
      {subView === "gapAnalysis" && <GapAnalysisView />}
    </div>
  );
}

export default ForecastIntelligenceTab;
