import { Fragment } from "react";
import { trpc } from "@/lib/trpc";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";
import { TableSkeleton } from "@/components/TableSkeleton";
import ExportSheetButton from "@/components/ExportSheetButton";
import ImportSheetButton from "@/components/ImportSheetButton";
import { useGridNav } from "@/hooks/useGridNav";
import { ForecastFocEditButton, ForecastFocRow, ForecastFocBanner, ForecastFocTotals, useForecastFoc } from "@/components/forecast/ForecastFoc";
import { displayValue, exactDisplayValue, fromMastercases, toMastercases } from "@/lib/forecastUnits";
import { RecordFocDialog } from "@/components/forecast/RecordFocDialog";

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

export default function ForecastPage() {
  const { user: appUser, isAdminFor } = useAppAuth();
  const { country, config } = useCountry();
  const { formatVal, unit } = useUnit();
  const isLebanon = country === "Lebanon";
  const utils = trpc.useUtils();
  const foc = useForecastFoc(country);
  const canEditForecast = !foc.supported || isAdminFor(foc.country);

  // Lebanon uses the existing data.forecast endpoint
  const { data: lbData, isLoading: lbLoading, isFetching: lbFetching, refetch: lbRefetch } = trpc.data.forecast.useQuery(undefined, { enabled: isLebanon, staleTime: 0, refetchOnWindowFocus: true });
  // Syria/Libya use the country.data endpoint
  const { data: intlData, isLoading: intlLoading, isFetching: intlFetching, refetch: intlRefetch } = trpc.country.data.useQuery(
    { country: country as "Syria" | "Libya" | "KSA" },
    { enabled: !isLebanon && (country === "Syria" || country === "Libya" || country === "KSA"), staleTime: 0, refetchOnWindowFocus: true }
  );

  const data = isLebanon
    ? lbData
    : intlData ? { skus: intlData.skus, periods: intlData.periods, data: intlData.forecast } : undefined;
  const isLoading = isLebanon ? lbLoading : intlLoading;
  const isFetching = isLebanon ? lbFetching : intlFetching;
  const refetchAll = isLebanon ? lbRefetch : intlRefetch;

  const updateCellLb = trpc.update.forecastCell.useMutation({
    onSuccess: () => {
      utils.data.forecast.invalidate();
      utils.data.imsVsForecast.invalidate();
      utils.data.planningFg.invalidate();
    },
    onError: (err: any) => toast.error("Failed to save: " + err.message),
  });
  const updateCellIntl = trpc.country.updateForecast.useMutation({
    onSuccess: () => {
      utils.country.data.invalidate();
      utils.country.planningFg.invalidate();
    },
    onError: (err: any) => toast.error("Failed to save: " + err.message),
  });
  const updateProductionIntl = trpc.country.updateProduction.useMutation({
    onSuccess: (_, input) => input.country === "Libya" || input.country === "Syria"
      ? foc.invalidate(input.country) : utils.country.data.invalidate(),
    onError: (err: any) => toast.error("Failed to sync production: " + err.message),
  });
  const updateForecastWeek = trpc.country.updateForecastWeek.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err: any) => toast.error("Failed to save week: " + err.message),
  });

  const updateCell = {
    mutate: (params: any) => {
      if (isLebanon) updateCellLb.mutate(params);
      else updateCellIntl.mutate({ ...params, country: country! });
    },
    isPending: isLebanon ? updateCellLb.isPending : updateCellIntl.isPending,
  };

  // Forecast→Production link: map of skuId-periodId → target week ("week1"|"week2"|"week3"|"week4")
  const [prodLinkWeek, setProdLinkWeek] = useState<Map<string, string>>(new Map());
  const [weekPickerOpen, setWeekPickerOpen] = useState<string | null>(null);

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const skipBlurRef = useRef(false);
  const [editValue, setEditValue] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [excludedSkuIds, setExcludedSkuIds] = useState<Set<number>>(new Set());
  const [excludeCore, setExcludeCore] = useState(false);
  const [excludeNPI, setExcludeNPI] = useState(false);
  const [sumDialogOpen, setSumDialogOpen] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [collapsedWeights, setCollapsedWeights] = useState<Set<string>>(new Set());
  // Filters (Syria/Libya only)
  const [filterSearch, setFilterSearch] = useState("");
  const [filterSize, setFilterSize] = useState<string>("All");
  const [filterPackaging, setFilterPackaging] = useState<string>("All");
  useEffect(() => {
    setEditingCell(null); setEditValue(""); setOldValue("");
  }, [country, unit]);
  useEffect(() => {
    setWeekPickerOpen(null); setProdLinkWeek(new Map()); weekMapInitialized.current = false;
    setExcludedSkuIds(new Set()); setExcludeCore(false); setExcludeNPI(false);
  }, [country]);

  const toggleYear = useCallback((year: number) => {
    setCollapsedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const toggleWeight = useCallback((weight: string) => {
    setCollapsedWeights(prev => {
      const next = new Set(prev);
      if (next.has(weight)) next.delete(weight);
      else next.add(weight);
      return next;
    });
  }, []);

  const dataMap = useMemo(() => {
    const map = new Map<string, string>();
    if (data?.data) {
      for (const d of data.data) {
        map.set(`${d.skuId}-${d.periodId}`, d.value ?? "0");
      }
    }
    return map;
  }, [data]);

  // Build targetWeek map from DB data (persisted week assignments)
  const dbWeekMap = useMemo(() => {
    const map = new Map<string, string>();
    if (data?.data) {
      for (const d of data.data) {
        if ((d as any).targetWeek) {
          map.set(`${d.skuId}-${d.periodId}`, (d as any).targetWeek);
        }
      }
    }
    return map;
  }, [data]);

  // Sync prodLinkWeek with DB data on first load only (avoid infinite loop)
  const weekMapInitialized = useRef(false);
  useEffect(() => {
    if (!weekMapInitialized.current && dbWeekMap.size > 0) {
      weekMapInitialized.current = true;
      setProdLinkWeek(new Map(dbWeekMap));
    }
  }, [dbWeekMap]);

  const allSkus = useMemo(() => (data?.skus ?? []).filter(s => !foc.supported || s.isActive !== false), [data?.skus, foc.supported]);
  const periods = data?.periods ?? [];

  // Sort SKUs: group by category (Core first, NPI second), then by weight (1kg, 250g, 50g), then by name
  const sortedSkus = useMemo(() => {
    return [...allSkus].sort((a, b) => {
      const catA = a.category === "Core" ? 0 : 1;
      const catB = b.category === "Core" ? 0 : 1;
      if (catA !== catB) return catA - catB;
      const wA = WEIGHT_ORDER[a.weight] ?? 9;
      const wB = WEIGHT_ORDER[b.weight] ?? 9;
      if (wA !== wB) return wA - wB;
      return a.name.localeCompare(b.name);
    });
  }, [allSkus]);

  // Filtered SKUs (Syria/Libya only)
  const filteredSkus = useMemo(() => {
    if (isLebanon) return sortedSkus;
    return sortedSkus.filter(sku => {
      if (filterSearch && !sku.name.toLowerCase().includes(filterSearch.toLowerCase())) return false;
      if (filterSize !== "All" && sku.weight !== filterSize) return false;
      if (filterPackaging !== "All" && ((sku as any).packagingType ?? 'New') !== filterPackaging) return false;
      return true;
    });
  }, [sortedSkus, isLebanon, filterSearch, filterSize, filterPackaging]);

  // Group for rendering with section headers (category > weight > skus)
  const groupedSkus = useMemo(() => {
    const groups: { category: string; weightGroups: { weight: string; skus: typeof filteredSkus }[] }[] = [];
    let currentCat = "";
    let currentWeight = "";
    for (const sku of filteredSkus) {
      if (sku.category !== currentCat) {
        currentCat = sku.category;
        currentWeight = "";
        groups.push({ category: currentCat, weightGroups: [] });
      }
      const catGroup = groups[groups.length - 1];
      if (sku.weight !== currentWeight) {
        currentWeight = sku.weight;
        catGroup.weightGroups.push({ weight: currentWeight, skus: [] });
      }
      catGroup.weightGroups[catGroup.weightGroups.length - 1].skus.push(sku);
    }
    return groups;
  }, [filteredSkus]);

  const formatNumber = (val: number) => val === 0 ? "" : foc.supported ? displayValue(val, unit) : formatVal(val, 0);

  const handleCellClick = useCallback((cellKey: string, currentValue: string) => {
    if (!canEditForecast) return;
    setEditingCell(cellKey);
    setOldValue(currentValue);
    setEditValue(currentValue === "0" ? "" : foc.supported ? String(fromMastercases(Number(currentValue), unit)) : currentValue);
  }, [canEditForecast, foc.supported, unit]);

  const handleCellSave = useCallback((skuId: number, periodId: number) => {
    if (!canEditForecast) return;
    if (foc.supported && (!Number.isFinite(Number(editValue)) || Number(editValue) < 0)) { toast.error("Enter a valid non-negative ordered quantity."); return; }
    const numVal = foc.supported ? toMastercases(Number(editValue), unit) : parseFloat(editValue) || 0;
    const sku = data?.skus.find(s => s.id === skuId);
    const period = data?.periods.find(p => p.id === periodId);
    updateCell.mutate({ skuId, periodId, value: numVal.toString(), skuName: sku?.name, periodLabel: period?.label, oldValue });
    // Forecast→Production auto-link (Syria/Libya only)
    if (!isLebanon && (country === "Syria" || country === "Libya" || country === "KSA")) {
      const cellKey = `${skuId}-${periodId}`;
      const targetWeek = prodLinkWeek.get(cellKey) ?? "week1";
      const weeks = { week1: "0", week2: "0", week3: "0", week4: "0", [targetWeek]: numVal.toString() };
      updateProductionIntl.mutate({
        skuId, periodId,
        week1: weeks.week1, week2: weeks.week2, week3: weeks.week3, week4: weeks.week4,
        country: country as "Syria" | "Libya" | "KSA",
        skuName: sku?.name, periodLabel: period?.label,
      });
    }
    setEditingCell(null);
  }, [editValue, updateCell, isLebanon, country, prodLinkWeek, updateProductionIntl, appUser, data, canEditForecast, foc.supported, unit]);

  // handleCellKeyDown is defined after periodsByYear (see below)

  const toggleExcludeSku = (skuId: number) => {
    setExcludedSkuIds(prev => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });
  };

  const toggleExcludeCategory = (cat: "Core" | "NPI") => {
    const catSkuIds = allSkus.filter(s => s.category === cat).map(s => s.id);
    if (cat === "Core") {
      setExcludeCore(!excludeCore);
      setExcludedSkuIds(prev => {
        const next = new Set(prev);
        if (!excludeCore) {
          catSkuIds.forEach(id => next.add(id));
        } else {
          catSkuIds.forEach(id => next.delete(id));
        }
        return next;
      });
    } else {
      setExcludeNPI(!excludeNPI);
      setExcludedSkuIds(prev => {
        const next = new Set(prev);
        if (!excludeNPI) {
          catSkuIds.forEach(id => next.add(id));
        } else {
          catSkuIds.forEach(id => next.delete(id));
        }
        return next;
      });
    }
  };

  const isSkuExcluded = (skuId: number) => excludedSkuIds.has(skuId);

  const years = Array.from(new Set(periods.map(p => p.year))).sort();
  const periodsByYear = years.map(year => ({
    year,
    periods: periods.filter(p => p.year === year).sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  // Build flat ordered list of all navigable cell IDs (row-major: sku0-p0, sku0-p1, ..., sku1-p0, ...)
   
  const navigableCellIds = useMemo(() => {
    const visiblePeriods = periodsByYear
      .filter(({ year }) => !collapsedYears.has(year))
      .flatMap(({ periods: yp }) => yp);
    const ids: string[] = [];
    for (const group of groupedSkus) {
      if (collapsedCategories.has(group.category)) continue;
      for (const wg of group.weightGroups) {
        if (collapsedWeights.has(wg.weight)) continue;
        for (const sku of wg.skus) {
          for (const p of visiblePeriods) {
            ids.push(`${sku.id}-${p.id}`);
          }
        }
      }
    }
    return ids;
   
  }, [groupedSkus, periodsByYear, collapsedYears, collapsedCategories, collapsedWeights]);

  const visiblePeriodCount = useMemo(() =>
    periodsByYear.filter(({ year }) => !collapsedYears.has(year)).flatMap(({ periods: yp }) => yp).length,
   
  [periodsByYear, collapsedYears]
  );

  const { handleNavKeyDown } = useGridNav({
    cellIds: navigableCellIds,
    editingCell,
    setEditingCell: (id) => {
      if (id === null) { setEditingCell(null); return; }
      const rawVal = dataMap.get(id) ?? "0";
      setEditingCell(id);
      setOldValue(rawVal);
      if (!canEditForecast) { setEditingCell(null); return; }
      setEditValue(rawVal === "0" ? "" : foc.supported ? String(fromMastercases(Number(rawVal), unit)) : rawVal);
    },
    onSave: (cellId) => {
      const parts = cellId.split("-");
      handleCellSave(parseInt(parts[0]), parseInt(parts[1]));
      skipBlurRef.current = true;
    },
    onCancel: () => setEditingCell(null),
    colCount: visiblePeriodCount,
  });

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, skuId: number, periodId: number) => {
    handleNavKeyDown(e, `${skuId}-${periodId}`);
  }, [handleNavKeyDown]);

  const computeTotal = (periodId: number) => {
    let total = 0;
    for (const sku of allSkus) {
      if (isSkuExcluded(sku.id)) continue;
      total += parseFloat(dataMap.get(`${sku.id}-${periodId}`) ?? "0") || 0;
    }
    return total;
  };

  const computeYearTotal = (skuId: number, year: number) => {
    const yPeriods = periods.filter(p => p.year === year);
    return yPeriods.reduce((sum, p) => sum + (parseFloat(dataMap.get(`${skuId}-${p.id}`) ?? "0") || 0), 0);
  };

  const computeColumnYearTotal = (year: number) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      if (isSkuExcluded(sku.id)) continue;
      for (const p of yPeriods) {
        total += parseFloat(dataMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
      }
    }
    return total;
  };

  // Category subtotals
  const computeCategoryTotal = (category: string, periodId: number) => {
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      if (isSkuExcluded(sku.id)) continue;
      total += parseFloat(dataMap.get(`${sku.id}-${periodId}`) ?? "0") || 0;
    }
    return total;
  };

  const computeCategoryYearTotal = (category: string, year: number) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      if (isSkuExcluded(sku.id)) continue;
      for (const p of yPeriods) {
        total += parseFloat(dataMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
      }
    }
    return total;
  };

  if (isLoading) return <TableSkeleton title="Forecast Production" rows={10} cols={14} />;

  const totalExcluded = excludedSkuIds.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{config?.terms.forecast ?? "Forecast"}</h1>
          <p className="text-sm text-muted-foreground mt-1">Monthly {isLebanon ? "forecast" : "forecast production"} by SKU. Grouped by Core/NPI, sorted by weight. {foc.supported ? "Figures follow the selected basis; editing changes ordered MC only." : "Click a monthly cell to edit."}</p>
        </div>
        <div className="flex items-center gap-2">
           {canEditForecast && <ImportSheetButton sheet="forecast" country={country} label="Import Forecast" />}
           {foc.supported && (country === "Libya" || country === "Syria") && isAdminFor(foc.country) && data && <RecordFocDialog country={foc.country} periods={periods} includeFoc={foc.includeFoc} onSaved={() => foc.invalidate(foc.country)} />}
           <ExportSheetButton sheet="forecast" country={country} label="Export Forecast" includeFoc={foc.supported ? foc.includeFoc : undefined} unit={foc.supported ? unit : undefined} />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCollapsedYears(new Set(years))}
              className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Collapse all years"
            >
              Collapse All
            </button>
            <button
              onClick={() => setCollapsedYears(new Set())}
              className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
              title="Expand all years"
            >
              Expand All
            </button>
            <button
              onClick={() => { refetchAll(); if (foc.supported) foc.query.refetch(); }}
              disabled={isFetching}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Sync all data from server"
            >
              <svg className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {isFetching ? 'Syncing...' : 'Sync All'}
            </button>
          </div>
          <Dialog open={sumDialogOpen} onOpenChange={setSumDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <Settings2 className="h-4 w-4" />
              SUM Options
              {totalExcluded > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full bg-destructive/10 text-destructive text-[10px] font-bold">
                  {totalExcluded} excluded
                </span>
              )}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>SUM Exclusion Settings</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mb-3">
              Exclude entire categories or individual SKUs from total calculations.
            </p>

            {/* Category-level toggles */}
            <div className="border rounded-lg p-3 mb-3 space-y-2 bg-muted">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Category Toggles</p>
              <label className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={excludeCore}
                  onCheckedChange={() => toggleExcludeCategory("Core")}
                />
                <span className="text-sm font-medium">Exclude all Core SKUs</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  ({allSkus.filter(s => s.category === "Core").length} SKUs)
                </span>
              </label>
              <label className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-muted cursor-pointer">
                <Checkbox
                  checked={excludeNPI}
                  onCheckedChange={() => toggleExcludeCategory("NPI")}
                />
                <span className="text-sm font-medium">Exclude all NPI SKUs</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  ({allSkus.filter(s => s.category === "NPI").length} SKUs)
                </span>
              </label>
            </div>

            {/* Individual SKU toggles */}
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Individual SKUs</p>
            <div className="max-h-[300px] overflow-y-auto space-y-0.5">
              {groupedSkus.map(group => (
                <Fragment key={`dialog-${group.category}`}>
                  <div className="sticky top-0 bg-background px-2 py-1.5 border-b">
                    <span className={`text-xs font-bold ${group.category === "Core" ? "text-emerald-700" : "text-violet-700"}`}>
                      {group.category}
                    </span>
                  </div>
                  {group.weightGroups.flatMap(wg => wg.skus).map(sku => (
                    <label key={sku.id} className="flex items-center gap-3 py-1.5 px-3 rounded hover:bg-muted cursor-pointer">
                      <Checkbox
                        checked={excludedSkuIds.has(sku.id)}
                        onCheckedChange={() => toggleExcludeSku(sku.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm">{sku.name}</span>
                        <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          sku.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                          sku.weight === '250g' ? 'bg-amber-100 text-amber-700' :
                          'bg-rose-100 text-rose-700'
                        }`}>{sku.weight}</span>
                      </div>
                    </label>
                  ))}
                </Fragment>
              ))}
            </div>
            <div className="flex justify-between items-center pt-3 border-t">
              <Button variant="ghost" size="sm" onClick={() => { setExcludedSkuIds(new Set()); setExcludeCore(false); setExcludeNPI(false); }}>Clear All</Button>
              <Button size="sm" onClick={() => setSumDialogOpen(false)}>Done</Button>
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {foc.supported && <ForecastFocBanner model={foc} canEdit={canEditForecast} />}

      {/* Filter bar — Syria/Libya only */}
      {!isLebanon && (
        <div className="flex flex-wrap items-center gap-2 pb-1">
          <input
            type="text"
            placeholder="Search SKU name..."
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            className="h-7 px-2 text-xs border border-border rounded bg-background focus:outline-none focus:ring-1 focus:ring-primary w-44"
          />
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground font-medium">Size:</span>
            {["All", "50g", "250g", "1kg"].map(s => (
              <button
                key={s}
                onClick={() => setFilterSize(s)}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                  filterSize === s
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                }`}
              >{s}</button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground font-medium">Packaging:</span>
            {["All", "New", "Old"].map(p => (
              <button
                key={p}
                onClick={() => setFilterPackaging(p)}
                className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border transition-colors ${
                  filterPackaging === p
                    ? 'bg-primary text-primary-foreground border-primary'
                    : p === 'New' ? 'bg-green-100 text-green-800 border-green-200 hover:bg-green-200'
                    : p === 'Old' ? 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200'
                    : 'bg-background text-muted-foreground border-border hover:bg-muted'
                }`}
              >{p}</button>
            ))}
          </div>
          {(filterSearch || filterSize !== "All" || filterPackaging !== "All") && (
            <button
              onClick={() => { setFilterSearch(""); setFilterSize("All"); setFilterPackaging("All"); }}
              className="px-2 py-0.5 text-[10px] font-medium rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
            >Clear filters</button>
          )}
          {(filterSearch || filterSize !== "All" || filterPackaging !== "All") && (
            <span className="text-[10px] text-muted-foreground">{filteredSkus.length} of {allSkus.length} SKUs</span>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[75vh] rounded-b-lg">
            <table className="text-xs table-fixed border-separate border-spacing-0" style={{ width: "100%", minWidth: 230 + periodsByYear.reduce((sum, group) => sum + (collapsedYears.has(group.year) ? 0 : group.periods.length) * 100 + 112, 0) }}>
              <colgroup>
                <col style={{ width: 50 }} />
                <col style={{ width: 180 }} />
                {periodsByYear.flatMap(({ year, periods: yPeriods }) => [
                  ...(!collapsedYears.has(year) ? yPeriods.map(p => <col key={`col-${p.id}`} style={{ width: 100 }} />) : []),
                  <col key={`col-total-${year}`} style={{ width: 112 }} />,
                ])}
              </colgroup>
              <thead>
                <tr className="sticky top-0 z-40 h-[30px] bg-[#7f1d1d] text-white">
                  <th className="sticky left-0 z-50 border-b border-[#9e4242] bg-[#7f1d1d] px-2 py-1 text-left font-semibold">Weight</th>
                  <th className="sticky left-[50px] z-50 border-r border-b border-[#9e4242] bg-[#7f1d1d] px-2 py-1 text-left font-semibold shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)]">SKU Name</th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <th
                        key={`yh-${year}`}
                        colSpan={isCollapsed ? 1 : yPeriods.length + 1}
                        className="border-b border-l border-[#9e4242] px-1 py-1 text-center font-semibold text-white cursor-pointer select-none hover:bg-[#681717] transition-colors"
                        onClick={() => toggleYear(year)}
                        title={isCollapsed ? `Expand ${year}` : `Collapse ${year}`}
                      >
                        <span className="inline-flex items-center gap-1 justify-center">
                          <svg className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          {year}
                        </span>
                      </th>
                    );
                  })}
                </tr>
                <tr className="sticky top-[30px] z-40 h-[26px] bg-[#8f2a2a] text-white">
                  <th className="sticky left-0 z-50 border-b border-[#9e4242] bg-[#8f2a2a] px-2 py-1"></th>
                  <th className="sticky left-[50px] z-50 border-r border-b border-[#9e4242] bg-[#8f2a2a] px-2 py-1 shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)]"></th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`sub-${year}`}>
                        {!isCollapsed && yPeriods.map(p => (
                          <th key={p.id} className="border-b border-[#9e4242] px-1 py-1 text-center text-white/90 text-[10px]"><span className="block truncate" title={p.label}>{p.label.split(' ')[0]}</span></th>
                        ))}
                        <th className="border-b border-l-2 border-amber-400 bg-[#f8edcf] px-1 py-1 text-center font-bold text-amber-900 text-[10px]">
                          {isCollapsed ? year : "Total"}
                        </th>
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedSkus.map(group => (
                  <Fragment key={`group-${group.category}`}>
                    {/* Category header row */}
                    <tr
                      className={`${group.category === "Core" ? "bg-[#e9f4ed]" : "bg-[#f0edf6]"} cursor-pointer select-none hover:brightness-95 transition-all`}
                      onClick={() => toggleCategory(group.category)}
                    >
                      <td className={`sticky left-0 z-20 border-b border-[#d7dfda] px-2 py-1 ${group.category === "Core" ? "bg-[#e9f4ed]" : "bg-[#f0edf6]"}`}></td>
                      <td className={`sticky left-[50px] z-20 border-r border-b border-[#d7dfda] px-2 py-1 font-bold text-xs tracking-wider uppercase shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)] ${group.category === "Core" ? "bg-[#e9f4ed]" : "bg-[#f0edf6]"}`} style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}>
                        <span className="inline-flex items-center gap-2">
                          <svg
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsedCategories.has(group.category) ? '' : 'rotate-90'}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          {group.category}
                          <span className="font-normal normal-case text-[10px] text-muted-foreground">
                            ({group.weightGroups.reduce((s, wg) => s + wg.skus.length, 0)} SKUs){collapsedCategories.has(group.category) ? ' — collapsed' : ''}
                          </span>
                        </span>
                      </td>
                      <td colSpan={periodsByYear.reduce((acc, py) => collapsedYears.has(py.year) ? acc + 1 : acc + py.periods.length + 1, 0)} className={`border-b border-[#d7dfda] ${group.category === "Core" ? "bg-[#e9f4ed]" : "bg-[#f0edf6]"}`}></td>
                    </tr>

                    {!collapsedCategories.has(group.category) && group.weightGroups.map(({ weight, skus: weightSkus }) => (
                      <Fragment key={`wg-${group.category}-${weight}`}>
                        {/* Weight group header */}
                        <tr
                          className="bg-slate-100 cursor-pointer select-none hover:bg-slate-200 transition-colors"
                          onClick={() => toggleWeight(`${group.category}-${weight}`)}
                        >
                          <td className="sticky left-0 z-20 border-b border-[#d7dfda] bg-[#edf0eb] px-2 py-1"></td>
                          <td className="sticky left-[50px] z-20 border-r border-b border-[#d7dfda] bg-[#edf0eb] px-2 py-1 text-xs font-semibold text-slate-600 shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)]">
                            <span className="inline-flex items-center gap-2">
                              <svg
                                className={`w-3 h-3 transition-transform duration-200 ${collapsedWeights.has(`${group.category}-${weight}`) ? '' : 'rotate-90'}`}
                                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                weight === '50g' ? 'bg-blue-100 text-blue-700' :
                                weight === '250g' ? 'bg-amber-100 text-amber-700' :
                                'bg-rose-100 text-rose-700'
                              }`}>{weight}</span>
                              <span className="text-[10px] text-muted-foreground font-normal">
                                {weightSkus.length} SKUs{collapsedWeights.has(`${group.category}-${weight}`) ? ' — collapsed' : ''}
                              </span>
                            </span>
                          </td>
                          <td colSpan={periodsByYear.reduce((acc, py) => collapsedYears.has(py.year) ? acc + 1 : acc + py.periods.length + 1, 0)} className="border-b border-[#d7dfda] bg-[#edf0eb]"></td>
                        </tr>
                        {!collapsedWeights.has(`${group.category}-${weight}`) && weightSkus.map((sku, idx) => (
                      <Fragment key={sku.id}><tr className={`h-7 border-b hover:bg-[#edf3ef] ${idx % 2 === 1 ? 'bg-[#f3f6f4]' : 'bg-[#fbfcfb]'}`}>
                        <td className={`sticky left-0 z-20 w-[50px] border-r border-[#d7dfda] ${idx % 2 === 1 ? 'bg-[#f3f6f4]' : 'bg-[#fbfcfb]'} px-1 py-1`}>
                          <div className="flex items-center">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              isSkuExcluded(sku.id) ? 'bg-[#e3e8e4] text-muted-foreground' :
                              sku.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                              sku.weight === '250g' ? 'bg-amber-100 text-amber-700' :
                              'bg-rose-100 text-rose-700'
                            }`}>{sku.weight}</span>
                          </div>
                        </td>
                        <td title={sku.name} className={`group/sku sticky left-[50px] z-20 w-[180px] border-r border-[#d7dfda] ${idx % 2 === 1 ? 'bg-[#f3f6f4]' : 'bg-[#fbfcfb]'} px-2 py-1 font-medium whitespace-nowrap shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)] ${isSkuExcluded(sku.id) ? "text-muted-foreground" : ""}`}>
                          <div className="flex items-center gap-1">
                          {!isLebanon && <span className={`mr-1 inline-flex items-center rounded px-1 py-0.5 text-[9px] font-semibold ${
                            isSkuExcluded(sku.id) ? 'bg-[#e3e8e4] text-muted-foreground' :
                            ((sku as any).packagingType ?? 'New') === 'New' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-700'
                          }`}>{(sku as any).packagingType ?? 'New'}</span>}
                          <span className="min-w-0 flex-1 truncate" title={sku.name}>{sku.name}</span>
                          {foc.supported && <ForecastFocEditButton sku={sku} years={periodsByYear} model={foc} canEdit={canEditForecast} />}
                          </div>
                        </td>
                        {periodsByYear.map(({ year, periods: yPeriods }) => {
                          const isYearCollapsed = collapsedYears.has(year);
                          return (
                          <Fragment key={`${sku.id}-y-${year}`}>
                            {!isYearCollapsed && yPeriods.map(p => {
                              const cellKey = `${sku.id}-${p.id}`;
                              const rawVal = dataMap.get(cellKey) ?? "0";
                              const numVal = parseFloat(rawVal) || 0;
                              const isEditing = editingCell === cellKey;

                              if (isEditing) {
                                return (
                                  <td key={cellKey} className="px-0.5 py-0.5">
                                    <input
                                      type="number"
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } handleCellSave(sku.id, p.id); }}
                                      onKeyDown={e => handleCellKeyDown(e, sku.id, p.id)}
                                      autoFocus
                                      className="w-full px-1 py-0.5 text-right text-xs border border-primary rounded bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                  </td>
                                );
                              }

                              const linkedWeek = prodLinkWeek.get(cellKey) ?? "week1";
                              const weekLabel = linkedWeek.replace("week", "W");
                              const isPickerOpen = weekPickerOpen === cellKey;
                              return (
                                <td
                                  key={cellKey}
                                  className={`px-1 py-1 text-right tabular-nums cursor-pointer hover:bg-primary/10 transition-colors relative group ${isSkuExcluded(sku.id) ? "text-muted-foreground" : ""}`}
                                  title={foc.supported ? undefined : `${p.label}: ${formatNumber(numVal)}`}
                                  onClick={() => handleCellClick(cellKey, rawVal)}
                                >
                                  {foc.supported
                                    ? <ForecastFocTotals skus={[sku]} periods={[p]} ordered={data?.data ?? []} model={foc} muted={isSkuExcluded(sku.id)} />
                                    : <span className="block truncate" title={exactDisplayValue(numVal, unit)}>{formatNumber(numVal)}</span>}
                                  {!isLebanon && numVal > 0 && (
                                    <button
                                      type="button"
                                      aria-label={`Production target ${weekLabel} for ${sku.name}, ${p.label}`}
                                      className={`absolute bottom-0 right-0 text-[9px] leading-3 font-semibold px-0.5 rounded-tl opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 transition-opacity ${isSkuExcluded(sku.id) ? "bg-[#e3e8e4] text-muted-foreground" : "bg-teal-100 text-teal-700 hover:bg-teal-200"}`}
                                      title={`Synced to Production ${weekLabel}. Click to change week.`}
                                      onClick={e => { e.stopPropagation(); if (canEditForecast) setWeekPickerOpen(isPickerOpen ? null : cellKey); }}
                                    >
                                      →{weekLabel}
                                    </button>
                                  )}
                                  {isPickerOpen && (
                                    <div
                                      className="absolute bottom-full right-0 z-50 bg-white border border-border rounded shadow-lg p-1.5 flex gap-1 mb-0.5"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      {["week1","week2","week3","week4"].map(w => (
                                        <button
                                          key={w}
                                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                                            linkedWeek === w ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-700 border-gray-200 hover:bg-teal-50"
                                          }`}
                                          onClick={() => {
                                             if (!canEditForecast) return;
                                             // Optimistically update local state
                                            setProdLinkWeek(prev => { const next = new Map(prev); next.set(cellKey, w); return next; });
                                            setWeekPickerOpen(null);
                                            // Persist to DB and sync Production
                                            if (!isLebanon && (country === "Syria" || country === "Libya" || country === "KSA")) {
                                              updateForecastWeek.mutate({
                                                skuId: sku.id, periodId: p.id,
                                                targetWeek: w,
                                                country: country as "Syria" | "Libya" | "KSA",
                                                skuName: sku.name, periodLabel: p.label,
                                              });
                                            }
                                            toast.success(`Week set to ${w.replace("week","W")} — Production updated`);
                                          }}
                                        >
                                          {w.replace("week","W")}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              );
                            })}
                            <td title={foc.supported ? `${year} selected-basis total` : `${year} total: ${exactDisplayValue(computeYearTotal(sku.id, year), unit)}`} className={`px-1 py-1 text-right tabular-nums font-semibold border-l-2 border-amber-400 bg-[#fbf2dc] text-amber-900 ${isSkuExcluded(sku.id) ? "text-muted-foreground" : ""}`}>
                              {foc.supported ? <ForecastFocTotals skus={[sku]} periods={yPeriods} ordered={data?.data ?? []} model={foc} muted={isSkuExcluded(sku.id)} /> : formatNumber(computeYearTotal(sku.id, year))}
                            </td>
                          </Fragment>
                          );
                        })}
                      </tr>
                      {foc.supported && <ForecastFocRow sku={sku} years={periodsByYear} collapsedYears={collapsedYears} model={foc} canEdit={canEditForecast} ordered={data?.data ?? []} />}
                      </Fragment>
                        ))}
                      </Fragment>
                    ))}

                    {/* Category subtotal row */}
                    <tr className={`font-semibold border-b ${group.category === "Core" ? "bg-[#e9f4ed]" : "bg-[#f0edf6]"}`}>
                      <td className={`sticky left-0 z-20 border-r border-[#d7dfda] px-2 py-1.5 ${group.category === "Core" ? "bg-[#e9f4ed]" : "bg-[#f0edf6]"}`}></td>
                      <td className={`sticky left-[50px] z-20 border-r border-[#d7dfda] px-2 py-1.5 whitespace-nowrap text-xs shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)] ${group.category === "Core" ? "bg-[#e9f4ed]" : "bg-[#f0edf6]"}`} style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}>
                        Subtotal {group.category}
                      </td>
                      {periodsByYear.map(({ year, periods: yPeriods }) => {
                        const isYearCollapsed = collapsedYears.has(year);
                        return (
                        <Fragment key={`subtot-${group.category}-${year}`}>
                          {!isYearCollapsed && yPeriods.map(p => (
                            <td key={`subtot-${group.category}-${p.id}`} title={`Subtotal ${group.category} · ${p.label}${foc.supported ? "" : `: ${exactDisplayValue(computeCategoryTotal(group.category, p.id), unit)}`}`} className="px-1 py-1.5 text-right tabular-nums text-xs" style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}>
                              {foc.supported ? <ForecastFocTotals skus={allSkus.filter(s => s.category === group.category && !isSkuExcluded(s.id))} periods={[p]} ordered={data?.data ?? []} model={foc} /> : formatNumber(computeCategoryTotal(group.category, p.id))}
                            </td>
                          ))}
                          <td title={foc.supported ? undefined : exactDisplayValue(computeCategoryYearTotal(group.category, year), unit)} className="px-1 py-1.5 text-right tabular-nums text-xs font-semibold border-l-2 border-amber-400 bg-[#f8edcf]" style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}>
                            {foc.supported ? <ForecastFocTotals skus={allSkus.filter(s => s.category === group.category && !isSkuExcluded(s.id))} periods={yPeriods} ordered={data?.data ?? []} model={foc} /> : formatNumber(computeCategoryYearTotal(group.category, year))}
                          </td>
                        </Fragment>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}

              </tbody>
              <tfoot className="[&_td]:border-t [&_td]:border-[#9e4242]">
                {/* Monthly totals and Grand Total remain visible while scrolling SKUs. */}
                <tr className="sticky bottom-0 z-30 h-[32px] border-t-2 border-[#681717] bg-[#7f1d1d] text-[12px] font-semibold text-white">
                  <td className="sticky left-0 z-40 border-r border-[#9e4242] bg-[#7f1d1d] px-2 py-1"></td>
                  <td className="sticky left-[50px] z-40 border-r border-[#9e4242] bg-[#7f1d1d] px-2 py-1 whitespace-nowrap shadow-[5px_0_8px_-7px_rgba(22,44,35,0.7)]">
                    <span className="block truncate text-[13px] font-semibold" title="Grand Total">Grand Total</span>
                    {totalExcluded > 0 && <span className="text-[10px] font-normal ml-1 text-white/75">({totalExcluded} excluded)</span>}
                  </td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isYearCollapsed = collapsedYears.has(year);
                    return (
                    <Fragment key={`gt-y-${year}`}>
                      {!isYearCollapsed && yPeriods.map(p => (
                        <td key={`gt-${p.id}`} title={`${p.label} grand total`} className="bg-[#7f1d1d] px-1 py-1 text-right tabular-nums text-white">
                          {foc.supported ? <ForecastFocTotals skus={allSkus.filter(s => !isSkuExcluded(s.id))} periods={[p]} ordered={data?.data ?? []} model={foc} prominent /> : <span className="block truncate" title={exactDisplayValue(computeTotal(p.id), unit)}>{formatNumber(computeTotal(p.id))}</span>}
                        </td>
                      ))}
                      <td className="px-1 py-1 text-right tabular-nums font-semibold border-l-2 border-amber-400 bg-[#f4e3b8] text-amber-900">
                        {foc.supported ? <ForecastFocTotals skus={allSkus.filter(s => !isSkuExcluded(s.id))} periods={yPeriods} ordered={data?.data ?? []} model={foc} grand /> : <span className="block truncate text-[13px]" title={exactDisplayValue(computeColumnYearTotal(year), unit)}>{formatNumber(computeColumnYearTotal(year))}</span>}
                      </td>
                    </Fragment>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
