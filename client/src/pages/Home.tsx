import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { Package, BarChart3, Truck, Box, ArrowRight, CalendarPlus, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuditAction } from "@/hooks/useAuditLog";

// Parse weights like "50g", "1kg", "500g", "0.5kg" into grams for sorting.
// Anything we can't parse goes to the end so the dashboard never crashes.
function weightToGrams(w: string): number {
  const m = w.trim().match(/^([\d.]+)\s*(g|kg)$/i);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const v = parseFloat(m[1]);
  return m[2].toLowerCase() === "kg" ? v * 1000 : v;
}

// Deterministic per-weight color palette — same index used by stat cards
// AND the SKU table badges, so the colors stay consistent.
const WEIGHT_PALETTE = [
  { card: "from-blue-500 to-indigo-600", badge: "bg-blue-100 text-blue-700" },
  { card: "from-amber-500 to-orange-600", badge: "bg-amber-100 text-amber-700" },
  { card: "from-rose-500 to-pink-600", badge: "bg-rose-100 text-rose-700" },
  { card: "from-violet-500 to-purple-600", badge: "bg-violet-100 text-violet-700" },
  { card: "from-emerald-500 to-green-600", badge: "bg-emerald-100 text-emerald-700" },
  { card: "from-cyan-500 to-blue-600", badge: "bg-cyan-100 text-cyan-700" },
  { card: "from-yellow-500 to-amber-600", badge: "bg-yellow-100 text-yellow-700" },
  { card: "from-fuchsia-500 to-pink-600", badge: "bg-fuchsia-100 text-fuchsia-700" },
] as const;

// Sorted distinct weights present on the country's SKUs, with their
// palette index. Drives both the stat cards and the table badges.
function useWeightBreakdown(skus: Array<{ weight: string }>) {
  return useMemo(() => {
    const sorted = Array.from(new Set(skus.map(s => s.weight)))
      .filter(Boolean)
      .sort((a, b) => weightToGrams(a) - weightToGrams(b));
    const indexByWeight = new Map<string, number>();
    sorted.forEach((w, i) => indexByWeight.set(w, i));
    return {
      weights: sorted,
      paletteFor: (w: string) => WEIGHT_PALETTE[(indexByWeight.get(w) ?? 0) % WEIGHT_PALETTE.length],
      countOf: (w: string) => skus.filter(s => s.weight === w).length,
    };
  }, [skus]);
}

// ─── Lebanon Dashboard ────────────────────────────────────────────────────────
function LebanonHome() {
  const { user: appUser } = useAppAuth();
  const logAudit = useAuditAction();
  const { data: skuData } = trpc.country.skus.useQuery({ country: "Lebanon" });
  const { data: periodData } = trpc.periods.list.useQuery({ country: "Lebanon" });
  const { data: existingYears } = trpc.periods.existingYears.useQuery({ country: "Lebanon" });
  const [, setLocation] = useLocation();
  const [showAddYear, setShowAddYear] = useState(false);
  const [yearToAdd, setYearToAdd] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const utils = trpc.useUtils();

  const addYearMutation = trpc.periods.addYear.useMutation({
    onSuccess: () => {
      toast.success(`Year ${yearToAdd} added successfully! All data grids have been extended.`);
      setShowAddYear(false);
      setYearToAdd("");
      utils.periods.list.invalidate();
      utils.periods.existingYears.invalidate();
      utils.data.forecast.invalidate();
      utils.data.ims.invalidate();
      utils.data.shipment.invalidate();
      utils.data.arrival.invalidate();
      utils.data.planningFg.invalidate();
      utils.data.imsVsForecast.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || "Failed to add year");
    },
  });

  const skus = skuData ?? [];
  const periods = periodData ?? [];
  const years = existingYears ?? [];

  // Dynamic per-weight breakdown — picks up custom weights (e.g. "500g")
  // automatically as soon as they exist on an active SKU.
  const { weights, paletteFor, countOf } = useWeightBreakdown(skus);

  const statCards = [
    { label: "Total SKUs", value: skus.length, icon: Package, color: "from-teal-500 to-emerald-600", textColor: "text-white" },
    ...weights.map(w => ({
      label: `${w} Products`,
      value: countOf(w),
      icon: Box,
      color: paletteFor(w).card,
      textColor: "text-white",
    })),
  ];

  const quickLinks = [
    { label: "Forecast", desc: "View and edit monthly forecasts", path: "/forecast", icon: BarChart3 },
    { label: "IMS vs Forecast", desc: "Compare actuals vs forecast", path: "/ims-vs-forecast", icon: BarChart3 },
    { label: "Shipment", desc: "Weekly production shipments", path: "/shipment", icon: Truck },
    { label: "Arrival to Regie", desc: "Weekly arrival tracking", path: "/arrival", icon: Truck },
    // One Planning FG quick-link per actual weight — uses the dynamic
    // /planning-fg/:weight route so custom weights work out of the box.
    ...weights.map(w => ({
      label: `Planning FG ${w}`,
      desc: "Finished goods planning",
      path: `/planning-fg/${encodeURIComponent(w)}`,
      icon: Box,
    })),
    { label: "Upload Data", desc: "Import Excel workbook", path: "/upload", icon: Package },
  ];

  const handleAddYear = () => {
    const yr = parseInt(yearToAdd);
    if (isNaN(yr) || yr < 2024 || yr > 2040) {
      toast.error("Please enter a valid year between 2024 and 2040");
      return;
    }
    if (years.includes(yr)) {
      toast.error(`Year ${yr} already exists`);
      return;
    }
    addYearMutation.mutate({ year: yr});
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch("/api/export-excel");
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error || "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      a.href = url;
      a.download = `SSOF_Planning_${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Excel file downloaded with live formulas, dashboard & navigation!");
      logAudit({ action: "export_excel", details: `Exported Excel file: SSOF_Planning_${dateStr}.xlsx` });
    } catch (err: any) {
      toast.error("Export failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsExporting(false);
    }
  };

  const suggestedYear = years.length > 0 ? Math.max(...years) + 1 : 2028;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SSOF Planning Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Lebanon — {periods.length} monthly periods tracked
            {years.length > 0 && <span className="ml-2 text-xs">({years.join(", ")})</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={isExporting || skus.length === 0}>
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export to Excel
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setYearToAdd(String(suggestedYear)); setShowAddYear(true); }}>
            <CalendarPlus className="h-4 w-4" />
            Add Year
          </Button>
        </div>
      </div>

      {showAddYear && (
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">Add a New Year</p>
                <p className="text-xs text-muted-foreground mb-3">
                  This will create 12 monthly periods and initialize all data grids for every existing SKU.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={2024} max={2040} value={yearToAdd}
                    onChange={e => setYearToAdd(e.target.value)}
                    className="w-28 px-3 py-1.5 text-sm border rounded-md bg-background"
                    placeholder="e.g. 2028"
                  />
                  <Button size="sm" onClick={handleAddYear} disabled={addYearMutation.isPending}>
                    {addYearMutation.isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Adding...</> : "Add Year"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddYear(false)} disabled={addYearMutation.isPending}>Cancel</Button>
                </div>
              </div>
              {years.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Existing years:</p>
                  <div className="flex gap-1 mt-1 flex-wrap justify-end">
                    {years.map(y => <span key={y} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted">{y}</span>)}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className={`rounded-xl bg-gradient-to-br ${card.color} p-5 shadow-lg`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-medium ${card.textColor} opacity-90`}>{card.label}</p>
                <p className={`text-3xl font-bold ${card.textColor} mt-1`}>{card.value}</p>
              </div>
              <card.icon className={`h-10 w-10 ${card.textColor} opacity-30`} />
            </div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-3">Quick Navigation</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {quickLinks.map(link => (
            <Card key={link.path} className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group" onClick={() => setLocation(link.path)}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <link.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{link.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{link.desc}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {skus.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">SKU Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">SKU Name</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Weight</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Planning Sheet</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map(sku => (
                    <tr key={sku.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-3 font-medium">{sku.name}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${paletteFor(sku.weight).badge}`}>{sku.weight}</span>
                      </td>
                      <td className="py-2.5 px-3 text-muted-foreground">
                        <span className="cursor-pointer hover:text-primary hover:underline transition-colors" onClick={() => setLocation(`/planning-fg/${encodeURIComponent(sku.weight)}`)}>
                          Planning FG {sku.weight}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {skus.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Data Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">Upload your SSOF Excel workbook to get started with planning.</p>
            <button onClick={() => setLocation("/upload")} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Upload Data <ArrowRight className="h-4 w-4" />
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Syria / Libya Dashboard ──────────────────────────────────────────────────
function IntlHome() {
  const { country } = useCountry();
  const [, setLocation] = useLocation();
  const [showAddYear, setShowAddYear] = useState(false);
  const [yearToAdd, setYearToAdd] = useState("");
  const utils = trpc.useUtils();

  const intlCountry = country as "Syria" | "Libya" | "KSA";

  const { data: skuData, isLoading: skusLoading } = trpc.country.skus.useQuery(
    { country: intlCountry },
    { enabled: !!country && country !== "Lebanon" }
  );

  const { data: periodsData } = trpc.country.existingYears.useQuery(
    { country: intlCountry },
    { enabled: !!country && country !== "Lebanon" }
  );

  const addYearMutation = trpc.country.addYear.useMutation({
    onSuccess: () => {
      toast.success(`Year ${yearToAdd} added successfully!`);
      setShowAddYear(false);
      setYearToAdd("");
      utils.country.skus.invalidate();
      utils.country.existingYears.invalidate();
    },
    onError: (err) => toast.error(err.message || "Failed to add year"),
  });

  const skus = skuData ?? [];
  const years = (periodsData ?? []) as number[];

  // Dynamic per-weight breakdown — picks up KSA's custom weights (e.g.
  // "300g", "500g") automatically as soon as they exist on an active SKU.
  const { weights, paletteFor, countOf } = useWeightBreakdown(skus);
  const statCards = [
    { label: "Total SKUs", value: skus.length, icon: Package, color: "from-teal-500 to-emerald-600", textColor: "text-white" },
    ...weights.map(w => ({
      label: `${w} Products`,
      value: countOf(w),
      icon: Box,
      color: paletteFor(w).card,
      textColor: "text-white",
    })),
    { label: "Planning Years", value: years.length, icon: BarChart3, color: "from-blue-500 to-indigo-600", textColor: "text-white" },
  ];

  const quickLinks = [
    { label: "Forecast Production", desc: "Monthly production forecast", path: "/forecast", icon: BarChart3 },
    { label: "Forecast vs Actual", desc: "Planned forecast vs actual production", path: "/forecast-vs-forecast", icon: BarChart3 },
    { label: "Production", desc: "Weekly production batches", path: "/shipment", icon: Truck },
    { label: "Arrival", desc: "Batch arrival tracking", path: "/arrival", icon: Truck },
    { label: "IMS", desc: "In-market sales data", path: "/ims-vs-forecast", icon: Box },
    { label: "SKU Management", desc: "Create and manage SKUs", path: "/sku-management", icon: Package },
  ];

  const handleAddYear = () => {
    const yr = parseInt(yearToAdd);
    if (isNaN(yr) || yr < 2024 || yr > 2040) {
      toast.error("Please enter a valid year between 2024 and 2040");
      return;
    }
    if (years.includes(yr)) {
      toast.error(`Year ${yr} already exists`);
      return;
    }
    addYearMutation.mutate({ country: intlCountry, year: yr });
  };

  const suggestedYear = years.length > 0 ? Math.max(...years) + 1 : 2025;
  const [isExporting, setIsExporting] = useState(false);
  const logAudit = useAuditAction();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch(`/api/export-excel?country=${encodeURIComponent(intlCountry)}`);
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Export failed" }));
        throw new Error(err.error || "Export failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      a.href = url;
      a.download = `SSOF_Planning_${intlCountry}_${dateStr}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${intlCountry} Excel file downloaded!`);
      logAudit({ action: "export_excel", details: `Exported Excel file: SSOF_Planning_${intlCountry}_${dateStr}.xlsx` });
    } catch (err: any) {
      toast.error("Export failed: " + (err?.message || "Unknown error"));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">SSOF Planning Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {country} — {years.length > 0 ? `${years.length} planning year${years.length > 1 ? 's' : ''}` : 'No planning years yet'}
            {years.length > 0 && <span className="ml-2 text-xs">({years.join(", ")})</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={handleExport} disabled={isExporting || skus.length === 0}>
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export to Excel
          </Button>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => { setYearToAdd(String(suggestedYear)); setShowAddYear(true); }}>
            <CalendarPlus className="h-4 w-4" />
            Add Year
          </Button>
        </div>
      </div>

      {showAddYear && (
        <Card className="border-2 border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium mb-1">Add a New Planning Year</p>
                <p className="text-xs text-muted-foreground mb-3">
                  Creates 12 monthly periods and initialises all planning grids for every existing {country} SKU.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number" min={2024} max={2040} value={yearToAdd}
                    onChange={e => setYearToAdd(e.target.value)}
                    className="w-28 px-3 py-1.5 text-sm border rounded-md bg-background"
                    placeholder="e.g. 2025"
                  />
                  <Button size="sm" onClick={handleAddYear} disabled={addYearMutation.isPending}>
                    {addYearMutation.isPending ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Adding...</> : "Add Year"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowAddYear(false)} disabled={addYearMutation.isPending}>Cancel</Button>
                </div>
              </div>
              {years.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Existing years:</p>
                  <div className="flex gap-1 mt-1 flex-wrap justify-end">
                    {years.map(y => <span key={y} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted">{y}</span>)}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className={`rounded-xl bg-gradient-to-br ${card.color} p-5 shadow-lg`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-sm font-medium ${card.textColor} opacity-90`}>{card.label}</p>
                <p className={`text-3xl font-bold ${card.textColor} mt-1`}>{card.value}</p>
              </div>
              <card.icon className={`h-10 w-10 ${card.textColor} opacity-30`} />
            </div>
          </div>
        ))}
      </div>

      {/* Quick Navigation */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Quick Navigation</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {quickLinks.map(link => (
            <Card key={link.path} className="cursor-pointer hover:shadow-md hover:border-primary/30 transition-all group" onClick={() => setLocation(link.path)}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <link.icon className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{link.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{link.desc}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* SKU Overview Table */}
      {!skusLoading && skus.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">{country} SKU Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">SKU Name</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Weight</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Packaging</th>
                    <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.map((sku: any) => (
                    <tr key={sku.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="py-2.5 px-3 font-medium">{sku.name}</td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${paletteFor(sku.weight).badge}`}>{sku.weight}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          sku.packagingType === 'Old' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'
                        }`}>{sku.packagingType ?? 'New'}</span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                          sku.category === 'NPI' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>{sku.category ?? 'Core'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {!skusLoading && skus.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No SKUs Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Go to SKU Management to create your first {country} SKU. Each SKU will automatically populate all planning tables.
            </p>
            <button onClick={() => setLocation("/sku-management")} className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              Manage SKUs <ArrowRight className="h-4 w-4" />
            </button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Root export — picks the right dashboard by country ───────────────────────
export default function Home() {
  const { country } = useCountry();
  if (country === "Lebanon") return <LebanonHome />;
  return <IntlHome />;
}
