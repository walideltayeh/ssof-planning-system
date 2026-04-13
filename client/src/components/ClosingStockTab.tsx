import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle, Filter, Package, TrendingDown, TrendingUp, Minus } from "lucide-react";

const ZONE_COLORS: Record<string, string> = {
  "Healthy": "#16a34a",
  "Critical": "#dc2626",
  "Negative": "#111827",
  "Overstock": "#ea580c",
  "Out of Stock": "#6b7280",
};

const ZONE_BG: Record<string, string> = {
  "Healthy": "bg-green-50 text-green-700 border-green-200",
  "Critical": "bg-red-50 text-red-700 border-red-200",
  "Negative": "bg-gray-100 text-gray-800 border-gray-300",
  "Overstock": "bg-orange-50 text-orange-700 border-orange-200",
  "Out of Stock": "bg-gray-50 text-gray-500 border-gray-200",
};

const WEEKS_BG = (w: number): string => {
  if (w <= 0) return "bg-gray-200 text-gray-800";
  if (w < 2) return "bg-red-600 text-white";
  if (w < 4) return "bg-red-400 text-white";
  if (w <= 6) return "bg-green-500 text-white";
  if (w <= 8) return "bg-yellow-400 text-gray-900";
  if (w <= 12) return "bg-orange-400 text-white";
  return "bg-orange-600 text-white";
};

function ClosingStockTab({ country }: { country: "Lebanon" | "Syria" | "Libya" }) {
  const [weightFilter, setWeightFilter] = useState<string>("all");
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const { data, isLoading, isError, error } = trpc.country.currentMonthClosingStock.useQuery({ country });

  const filteredSkus = useMemo(() => {
    if (!data) return [];
    let skus = [...data.skuData];
    if (weightFilter !== "all") skus = skus.filter(s => s.weight === weightFilter);
    if (zoneFilter !== "all") skus = skus.filter(s => s.zone === zoneFilter);
    skus.sort((a: any, b: any) => {
      const av = typeof a[sortField] === "string" ? a[sortField] : (a[sortField] ?? 0);
      const bv = typeof b[sortField] === "string" ? b[sortField] : (b[sortField] ?? 0);
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return skus;
  }, [data, weightFilter, zoneFilter, sortField, sortDir]);

  const toggleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir(field === "name" ? "asc" : "desc"); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-muted-foreground">Loading closing stock data...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-10">
        <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
        <p className="text-sm text-red-600">Failed to load closing stock data</p>
        <p className="text-xs text-muted-foreground mt-1">{error?.message || "Unknown error"}</p>
      </div>
    );
  }

  if (!data || data.skuData.length === 0) {
    return <p className="text-center text-muted-foreground py-10">No closing stock data available for the current month.</p>;
  }

  const { summary, periodLabel } = data;
  const uniqueWeights = [...new Set(data.skuData.map(s => s.weight))].sort();
  const uniqueZones = [...new Set(data.skuData.map(s => s.zone))].sort();

  const SortHeader = ({ field, label, align }: { field: string; label: string; align?: string }) => (
    <th
      className={`px-3 py-2.5 text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap ${align === "right" ? "text-right" : "text-left"}`}
      onClick={() => toggleSort(field)}
    >
      {label} {sortField === field ? (sortDir === "desc" ? "↓" : "↑") : ""}
    </th>
  );

  const totalZones = summary.healthyCt + summary.criticalCt + summary.overstockCt + summary.outOfStockCt;
  const zoneData = [
    { label: "Healthy", count: summary.healthyCt, color: ZONE_COLORS["Healthy"] },
    { label: "Critical", count: summary.criticalCt, color: ZONE_COLORS["Critical"] },
    { label: "Overstock", count: summary.overstockCt, color: ZONE_COLORS["Overstock"] },
    { label: "Out of Stock", count: summary.outOfStockCt, color: ZONE_COLORS["Out of Stock"] },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Package className="h-5 w-5 text-slate-600" />
        <h2 className="text-sm font-semibold text-slate-700">
          Closing Stock — {periodLabel}
        </h2>
        <span className="text-xs text-muted-foreground ml-1">
          (mirrors Planning FG calculation)
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
          <CardContent className="p-3 pl-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Opening Stock</p>
            <p className="text-lg font-bold text-blue-600">{summary.totalOpeningStock.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
          <CardContent className="p-3 pl-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Arrivals</p>
            <p className="text-lg font-bold text-emerald-600">{summary.totalArrivals.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
          <CardContent className="p-3 pl-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">IMS (Sales)</p>
            <p className="text-lg font-bold text-amber-600">{summary.totalIms.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1 h-full bg-purple-500" />
          <CardContent className="p-3 pl-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Adjustments</p>
            <p className="text-lg font-bold text-purple-600">{summary.totalAdjustments.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="relative overflow-hidden">
          <div className={`absolute top-0 left-0 w-1 h-full ${summary.totalClosingStock >= 0 ? 'bg-slate-600' : 'bg-red-500'}`} />
          <CardContent className="p-3 pl-4">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Closing Stock</p>
            <p className={`text-lg font-bold ${summary.totalClosingStock >= 0 ? 'text-slate-800' : 'text-red-600'}`}>{summary.totalClosingStock.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Stock Health Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-1 h-8 rounded overflow-hidden">
              {zoneData.filter(z => z.count > 0).map(z => (
                <div
                  key={z.label}
                  className="h-full flex items-center justify-center text-white text-[10px] font-bold transition-all"
                  style={{ width: `${(z.count / totalZones) * 100}%`, backgroundColor: z.color, minWidth: z.count > 0 ? 28 : 0 }}
                  title={`${z.label}: ${z.count}`}
                >
                  {z.count}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              {zoneData.map(z => (
                <div key={z.label} className="flex items-center gap-1.5 text-xs">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: z.color }} />
                  <span className="text-muted-foreground">{z.label}</span>
                  <span className="font-semibold">{z.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Formula Reference</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1.5">
            <p><strong>Closing Stock</strong> = Opening Stock + Adjustments + Arrivals − IMS</p>
            {country === "Lebanon" ? (
              <p><strong>Weeks of Stock</strong> = (Closing Stock ÷ Avg next 2 months IMS) × 4.3</p>
            ) : (
              <p><strong>Weeks of Stock</strong> = (Closing Stock ÷ Current IMS) × 4</p>
            )}
            <p className="text-muted-foreground mt-2">
              {country === "Lebanon"
                ? "Arrivals = Planning FG value if set, otherwise sum of weekly arrival data"
                : "Arrivals = Cleared shipment mastercases by cleared date month"}
            </p>
            <p className="text-muted-foreground">For future periods, Forecast is used as effective IMS when actual IMS is zero.</p>
          </CardContent>
        </Card>
      </div>

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
          value={zoneFilter}
          onChange={e => setZoneFilter(e.target.value)}
        >
          <option value="all">All Zones</option>
          {uniqueZones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filteredSkus.length} of {data.skuData.length} SKUs</span>
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-xs">
          <thead className="bg-muted/70">
            <tr>
              <SortHeader field="name" label="SKU" />
              <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground text-center">Weight</th>
              <SortHeader field="openingStock" label="Opening" align="right" />
              <SortHeader field="adjustments" label="Adj" align="right" />
              <SortHeader field="arrivals" label="Arrivals" align="right" />
              <SortHeader field="ims" label="IMS" align="right" />
              <SortHeader field="invoiced" label="Invoiced" align="right" />
              <SortHeader field="closingStock" label="Closing Stock" align="right" />
              <SortHeader field="weeksOfStock" label="Weeks" align="right" />
              <th className="px-3 py-2.5 text-xs font-semibold text-muted-foreground text-center">Zone</th>
            </tr>
          </thead>
          <tbody>
            {filteredSkus.map((s, i) => (
              <tr key={s.id} className={`${i % 2 === 0 ? "bg-white" : "bg-muted/20"} hover:bg-blue-50/40 transition-colors`}>
                <td className="px-3 py-2 font-medium max-w-[200px] truncate" title={s.name}>{s.name}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.weight === "1kg" ? "bg-red-50 text-red-700" : s.weight === "250g" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                    {s.weight}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{s.openingStock.toLocaleString()}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${s.adjustments !== 0 ? (s.adjustments > 0 ? 'text-green-600' : 'text-red-600') : 'text-muted-foreground'}`}>
                  {s.adjustments !== 0 ? (s.adjustments > 0 ? "+" : "") + s.adjustments.toLocaleString() : "—"}
                </td>
                <td className={`px-3 py-2 text-right tabular-nums ${s.arrivals > 0 ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}`}>
                  {s.arrivals > 0 ? s.arrivals.toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{s.ims.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{s.invoiced.toLocaleString()}</td>
                <td className={`px-3 py-2 text-right tabular-nums font-bold ${s.closingStock < 0 ? 'text-red-600' : s.closingStock === 0 ? 'text-gray-400' : ''}`}>
                  {s.closingStock.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold tabular-nums ${WEEKS_BG(s.weeksOfStock)}`}>
                    {s.weeksOfStock >= 99 ? "∞" : s.weeksOfStock <= -99 ? "-∞" : s.weeksOfStock.toFixed(1)}
                  </span>
                </td>
                <td className="px-3 py-2 text-center">
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-medium ${ZONE_BG[s.zone] || ""}`}>
                    {s.zone}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted/50 font-semibold border-t-2">
            <tr>
              <td className="px-3 py-2">Total ({filteredSkus.length} SKUs)</td>
              <td></td>
              <td className="px-3 py-2 text-right tabular-nums">{filteredSkus.reduce((s, d) => s + d.openingStock, 0).toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{filteredSkus.reduce((s, d) => s + d.adjustments, 0).toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{filteredSkus.reduce((s, d) => s + d.arrivals, 0).toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{filteredSkus.reduce((s, d) => s + d.ims, 0).toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums">{filteredSkus.reduce((s, d) => s + d.invoiced, 0).toLocaleString()}</td>
              <td className="px-3 py-2 text-right tabular-nums font-bold">{filteredSkus.reduce((s, d) => s + d.closingStock, 0).toLocaleString()}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

export default ClosingStockTab;
