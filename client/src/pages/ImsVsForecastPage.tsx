import { Fragment } from "react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useMemo, useState, useCallback, useRef } from "react";
import { useGridNav } from "@/hooks/useGridNav";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import ExportSheetButton from "@/components/ExportSheetButton";
import ImportSheetButton from "@/components/ImportSheetButton";

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

export default function ImsVsForecastPage() {
  const { user: appUser } = useAppAuth();
  const { country, config } = useCountry();
  const { formatVal, unitLabel } = useUnit();
  const isLebanon = country === "Lebanon";
  const utils = trpc.useUtils();

  const { data: lbData, isLoading: lbLoading } = trpc.data.imsVsForecast.useQuery(undefined, { enabled: isLebanon, staleTime: 0, refetchOnWindowFocus: true });
  const { data: intlData, isLoading: intlLoading } = trpc.country.data.useQuery(
    { country: country as "Syria" | "Libya" | "KSA" },
    { enabled: !isLebanon && (country === "Syria" || country === "Libya" || country === "KSA") }
  );
  // For Syria/Libya: IMS tab shows IMS data (editable) vs Forecast Production (read-only)
  const data = isLebanon
    ? lbData
    : intlData
      ? { skus: intlData.skus, periods: intlData.periods, forecast: intlData.forecast, ims: intlData.ims }
      : undefined;
  const isLoading = isLebanon ? lbLoading : intlLoading;

  const updateImsCellLb = trpc.update.imsCell.useMutation({
    onSuccess: () => { utils.data.imsVsForecast.invalidate(); utils.data.planningFg.invalidate(); },
    onError: (err) => toast.error("Failed to save: " + err.message),
  });
  const updateImsCellIntl = trpc.country.updateForecast.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to save: " + err.message),
  });
  const updateImsCell = {
    mutate: (params: any) => {
      if (isLebanon) updateImsCellLb.mutate({ ...params, country: "Lebanon" });
      else updateImsCellIntl.mutate({ ...params, country: country! });
    },
    isPending: isLebanon ? updateImsCellLb.isPending : updateImsCellIntl.isPending,
  };

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const skipBlurRef = useRef(false);
  const [editValue, setEditValue] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [collapsedWeights, setCollapsedWeights] = useState<Set<string>>(new Set());

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [weightFilter, setWeightFilter] = useState<string>("All");
  const [categoryFilter, setCategoryFilter] = useState<string>("All");
  const [confirmAutoFill, setConfirmAutoFill] = useState<number | null>(null);
  const [autoFilledPeriods, setAutoFilledPeriods] = useState<Set<number>>(new Set());

  const autoFillMutation = trpc.update.autoFillImsFromForecast.useMutation({
    onSuccess: (result, variables) => {
      toast.success(`Auto-filled ${result.filled} IMS cells from Forecast`);
      setAutoFilledPeriods(prev => { const next = new Set(prev); next.add(variables.periodId); return next; });
      setConfirmAutoFill(null);
      if (isLebanon) {
        utils.data.imsVsForecast.invalidate();
        utils.data.planningFg.invalidate();
      } else {
        utils.country.data.invalidate();
      }
    },
    onError: (err) => {
      toast.error("Auto-fill failed: " + err.message);
      setConfirmAutoFill(null);
    },
  });

  const handleAutoFill = useCallback((periodId: number) => {
    if (confirmAutoFill === periodId) {
      // Second click = confirm
      autoFillMutation.mutate({
        periodId,
        country: country ?? undefined,
      });
    } else {
      // First click = ask for confirmation
      setConfirmAutoFill(periodId);
      // Auto-dismiss after 3 seconds
      setTimeout(() => setConfirmAutoFill(prev => prev === periodId ? null : prev), 3000);
    }
  }, [confirmAutoFill, autoFillMutation, appUser, country]);

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const toggleWeight = useCallback((key: string) => {
    setCollapsedWeights(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const toggleYear = useCallback((year: number) => {
    setCollapsedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }, []);

  const forecastMap = useMemo(() => {
    const map = new Map<string, string>();
    if (data?.forecast) {
      for (const d of data.forecast) map.set(`${d.skuId}-${d.periodId}`, d.value ?? "0");
    }
    return map;
  }, [data]);

  const imsMap = useMemo(() => {
    const map = new Map<string, { value: string; isActual: boolean }>();
    if (data?.ims) {
      for (const d of data.ims) map.set(`${d.skuId}-${d.periodId}`, { value: d.value ?? "0", isActual: d.isActual ?? false });
    }
    return map;
  }, [data]);

  const allSkus = data?.skus ?? [];
  const periods = data?.periods ?? [];
  const years = Array.from(new Set(periods.map(p => p.year))).sort();
  const periodsByYear = years.map(year => ({
    year,
    periods: periods.filter(p => p.year === year).sort((a, b) => a.sortOrder - b.sortOrder),
  }));

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

  // Filtered SKUs based on search and filters
  const filteredSkus = useMemo(() => {
    return sortedSkus.filter(sku => {
      if (searchQuery && !sku.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (weightFilter !== "All" && sku.weight !== weightFilter) return false;
      if (categoryFilter !== "All" && sku.category !== categoryFilter) return false;
      return true;
    });
  }, [sortedSkus, searchQuery, weightFilter, categoryFilter]);

  const isFiltering = searchQuery !== "" || weightFilter !== "All" || categoryFilter !== "All";

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

  const formatNumber = (val: number) => val === 0 ? "-" : formatVal(val);

  const [oldValue, setOldValue] = useState("");

  const handleCellClick = useCallback((cellKey: string, currentValue: string) => {
    setEditingCell(cellKey);
    setOldValue(currentValue);
    setEditValue(currentValue === "0" ? "" : currentValue);
  }, []);

  const handleCellSave = useCallback((skuId: number, periodId: number) => {
    const numVal = parseFloat(editValue) || 0;
    const imsEntry = imsMap.get(`${skuId}-${periodId}`);
    const sku = data?.skus.find(s => s.id === skuId);
    const period = data?.periods.find(p => p.id === periodId);
    updateImsCell.mutate({ skuId, periodId, value: numVal.toString(), isActual: imsEntry?.isActual ?? false, skuName: sku?.name, periodLabel: period?.label, oldValue });
    setEditingCell(null);
  }, [editValue, updateImsCell, imsMap, oldValue, data]);

  // Build navigable cell IDs for IMS row only (IMS is the editable row)
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
      const entry = imsMap.get(id);
      const rawVal = entry?.value ?? "0";
      setEditingCell(id);
      setOldValue(rawVal);
      setEditValue(rawVal === "0" ? "" : rawVal);
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

  // Category subtotals for Forecast (always computed from allSkus for subtotal rows)
  const computeCatForecastTotal = (category: string, periodId: number) => {
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      total += parseFloat(forecastMap.get(`${sku.id}-${periodId}`) ?? "0") || 0;
    }
    return total;
  };

  const computeCatImsTotal = (category: string, periodId: number) => {
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      total += parseFloat(imsMap.get(`${sku.id}-${periodId}`)?.value ?? "0") || 0;
    }
    return total;
  };

  const computeCatForecastYearTotal = (category: string, year: number) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      for (const p of yPeriods) total += parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
    }
    return total;
  };

  const computeCatImsYearTotal = (category: string, year: number) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      for (const p of yPeriods) total += parseFloat(imsMap.get(`${sku.id}-${p.id}`)?.value ?? "0") || 0;
    }
    return total;
  };

  // Grand totals
  const computeGrandForecastTotal = (periodId: number) => {
    let total = 0;
    for (const sku of allSkus) total += parseFloat(forecastMap.get(`${sku.id}-${periodId}`) ?? "0") || 0;
    return total;
  };

  const computeGrandImsTotal = (periodId: number) => {
    let total = 0;
    for (const sku of allSkus) total += parseFloat(imsMap.get(`${sku.id}-${periodId}`)?.value ?? "0") || 0;
    return total;
  };

  const computeGrandForecastYearTotal = (year: number) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      for (const p of yPeriods) total += parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
    }
    return total;
  };

  const computeGrandImsYearTotal = (year: number) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      for (const p of yPeriods) total += parseFloat(imsMap.get(`${sku.id}-${p.id}`)?.value ?? "0") || 0;
    }
    return total;
  };

  // Compute column count dynamically based on collapsed years
  const totalColCount = 3 + periodsByYear.reduce((acc, py) => {
    if (collapsedYears.has(py.year)) return acc + 1; // only year total column
    return acc + py.periods.length + 1;
  }, 0);

  if (isLoading) return <TableSkeleton title="IMS vs Forecast" rows={10} cols={14} />;

  const weights = ["All", "1kg", "250g", "50g"];
  const categories = ["All", "Core", "NPI"];

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{config?.terms.forecastVsIms ?? "IMS vs Forecast"}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {isLebanon
                ? "Compare IMS actuals against forecast."
                : "Compare IMS actuals against Forecast Production."}
              {" "}Grouped by Core/NPI, sorted by weight.
              <span className="inline-block w-3 h-3 bg-emerald-100 rounded-sm align-middle mx-1"></span>Actual
              <span className="inline-block w-3 h-3 bg-amber-50 rounded-sm align-middle mx-1 ml-2"></span>Forecast.
              Click IMS cells to edit. Click year headers to collapse months.
            </p>
          </div>
          <ImportSheetButton sheet="ims" country={country} label="Import IMS" />
          <ExportSheetButton sheet="ims" country={country} label="Export IMS" />
        </div>
      </div>

      {/* Search & Filter Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search input */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search SKU name..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Weight filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium">Weight:</span>
          {weights.map(w => (
            <button
              key={w}
              onClick={() => setWeightFilter(w)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                weightFilter === w
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary hover:text-foreground"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium">Category:</span>
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                categoryFilter === c
                  ? c === "Core" ? "bg-emerald-600 text-white border-emerald-600"
                  : c === "NPI" ? "bg-violet-600 text-white border-violet-600"
                  : "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border text-muted-foreground hover:border-primary hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Year collapse controls + match count + clear — always visible */}
        <div className="flex items-center gap-2 ml-auto">
          {isFiltering && (
            <span className="text-xs text-muted-foreground">
              {filteredSkus.length} of {allSkus.length} SKUs
            </span>
          )}
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
          </div>
          {isFiltering && (
            <button
              onClick={() => { setSearchQuery(""); setWeightFilter("All"); setCategoryFilter("All"); }}
              className="text-xs text-primary hover:underline border-l border-border pl-2"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[75vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                <tr className="bg-muted">
                  <th className="sticky left-0 bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[50px]">Weight</th>
                  <th className="sticky left-[50px] bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[180px]">SKU Name</th>
                  <th className="sticky left-[230px] bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[60px]">Type</th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <th
                        key={`yh-${year}`}
                        colSpan={isCollapsed ? 1 : yPeriods.length + 1}
                        className="px-1 py-1 text-center font-bold border-l border-border text-primary cursor-pointer select-none hover:bg-muted/80 transition-colors"
                        onClick={() => toggleYear(year)}
                        title={isCollapsed ? `Expand ${year}` : `Collapse ${year}`}
                      >
                        <span className="inline-flex items-center gap-1 justify-center">
                          <svg
                            className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          {year}
                        </span>
                      </th>
                    );
                  })}
                </tr>
                <tr className="bg-muted border-b">
                  <th className="sticky left-0 bg-muted z-30 px-2 py-1"></th>
                  <th className="sticky left-[50px] bg-muted z-30 px-2 py-1"></th>
                  <th className="sticky left-[230px] bg-muted z-30 px-2 py-1"></th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`sub-${year}`}>
                        {!isCollapsed && yPeriods.map(p => {
                          const isConfirming = confirmAutoFill === p.id;
                          const wasFilled = autoFilledPeriods.has(p.id);
                          return (
                            <th key={p.id} className="px-1 py-1 text-center text-muted-foreground min-w-[60px]">
                              <div className="text-[10px]">{p.label.split(' ')[0]}</div>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAutoFill(p.id); }}
                                disabled={autoFillMutation.isPending}
                                className={`mt-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded transition-all leading-tight ${
                                  wasFilled
                                    ? 'bg-emerald-100 text-emerald-700 cursor-default'
                                    : isConfirming
                                    ? 'bg-amber-500 text-white animate-pulse hover:bg-amber-600'
                                    : 'bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-800'
                                } disabled:opacity-50`}
                                title={wasFilled ? 'Already auto-filled' : isConfirming ? 'Click again to confirm' : 'Auto-fill IMS from Forecast for this month'}
                              >
                                {wasFilled ? '\u2713 Filled' : isConfirming ? 'Confirm?' : 'Auto-Fill'}
                              </button>
                            </th>
                          );
                        })}
                        <th className="px-1 py-1 text-center font-semibold border-l border-border bg-muted min-w-[70px] text-[10px]">
                          {isCollapsed ? year : "Total"}
                        </th>
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedSkus.length === 0 && (
                  <tr>
                    <td colSpan={totalColCount} className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No SKUs match the current filters.
                    </td>
                  </tr>
                )}
                {groupedSkus.map(group => (
                  <Fragment key={`group-${group.category}`}>
                    {/* Category header row */}
                    <tr
                      className={`${group.category === "Core" ? "bg-emerald-50" : "bg-violet-50"} cursor-pointer select-none hover:brightness-95 transition-all`}
                      onClick={() => toggleCategory(group.category)}
                    >
                      <td colSpan={totalColCount}
                        className="px-3 py-1.5 font-bold text-xs tracking-wider uppercase sticky left-0 z-10"
                        style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}
                      >
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
                    </tr>

                    {!collapsedCategories.has(group.category) && group.weightGroups.map(({ weight, skus: weightSkus }) => (
                      <Fragment key={`wg-${group.category}-${weight}`}>
                        {/* Weight group header */}
                        <tr
                          className="bg-slate-100 cursor-pointer select-none hover:bg-slate-200 transition-colors"
                          onClick={() => toggleWeight(`${group.category}-${weight}`)}
                        >
                          <td colSpan={totalColCount}
                            className="px-4 py-1 text-xs font-semibold text-slate-600 sticky left-0 z-10"
                          >
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
                        </tr>
                        {!collapsedWeights.has(`${group.category}-${weight}`) && weightSkus.map((sku, skuIdx) => {
                          const isOddSku = skuIdx % 2 === 1;
                          const stripeBg = isOddSku ? 'bg-slate-50' : '';
                          return (
                          <Fragment key={`sku-${sku.id}`}>
                        {/* Forecast row */}
                        <tr className={`border-b ${isOddSku ? 'bg-amber-100' : 'bg-amber-50'} hover:bg-amber-100`}>
                          <td className={`sticky left-0 ${isOddSku ? 'bg-amber-100' : 'bg-amber-50'} z-10 px-2 py-1.5`} rowSpan={3}>
                            <div className="flex flex-col items-start gap-0.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                sku.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                                sku.weight === '250g' ? 'bg-amber-100 text-amber-700' :
                                'bg-rose-100 text-rose-700'
                              }`}>{sku.weight}</span>
                              {!isLebanon && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  ((sku as any).packagingType ?? 'New') === 'New' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-700'
                                }`}>{(sku as any).packagingType ?? 'New'}</span>
                              )}
                            </div>
                          </td>
                          <td className={`sticky left-[50px] ${isOddSku ? 'bg-amber-100' : 'bg-amber-50'} z-10 px-2 py-1.5 font-medium whitespace-nowrap`} rowSpan={3}>{sku.name}</td>
                          <td className="px-2 py-1.5 text-amber-600 font-medium text-[10px]">FRCST</td>
                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            const isCollapsed = collapsedYears.has(year);
                            let yearTotal = 0;
                            for (const p of yPeriods) yearTotal += parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                            return (
                              <Fragment key={`f-${sku.id}-y-${year}`}>
                                {!isCollapsed && yPeriods.map(p => {
                                  const val = parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                                  return (
                                    <td key={`f-${sku.id}-${p.id}`} className="px-1 py-1.5 text-right tabular-nums text-amber-700">
                                      {formatNumber(val)}
                                    </td>
                                  );
                                })}
                                <td className={`px-1 py-1.5 text-right tabular-nums font-semibold border-l border-border ${isOddSku ? 'bg-amber-100' : 'bg-amber-50'} text-amber-700`}>
                                  {formatNumber(yearTotal)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                        {/* IMS row */}
                        <tr className={`border-b ${stripeBg} hover:bg-muted`}>
                          <td className="px-2 py-1.5 text-emerald-600 font-medium text-[10px]">IMS</td>
                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            const isCollapsed = collapsedYears.has(year);
                            let yearTotal = 0;
                            for (const p of yPeriods) yearTotal += parseFloat(imsMap.get(`${sku.id}-${p.id}`)?.value ?? "0") || 0;
                            return (
                              <Fragment key={`i-${sku.id}-y-${year}`}>
                                {!isCollapsed && yPeriods.map(p => {
                                  const imsEntry = imsMap.get(`${sku.id}-${p.id}`);
                                  const val = parseFloat(imsEntry?.value ?? "0") || 0;
                                  const isActual = imsEntry?.isActual ?? false;
                                  const cellKey = `ims-${sku.id}-${p.id}`;
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

                                  return (
                                    <td
                                      key={cellKey}
                                      className={`px-1 py-1.5 text-right tabular-nums cursor-pointer hover:bg-primary/10 transition-colors ${
                                        isActual ? 'bg-emerald-50 font-medium text-emerald-800' : ''
                                      }`}
                                      onClick={() => handleCellClick(cellKey, imsEntry?.value ?? "0")}
                                    >
                                      {formatNumber(val)}
                                    </td>
                                  );
                                })}
                                <td className="px-1 py-1.5 text-right tabular-nums font-semibold border-l border-border bg-muted">
                                  {formatNumber(yearTotal)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                        {/* Variance row */}
                        <tr className={`border-b border-border ${isOddSku ? 'bg-slate-100' : 'bg-gray-50'}`}>
                          <td className="px-2 py-1.5 text-muted-foreground italic text-[10px]">Variance</td>
                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            const isCollapsed = collapsedYears.has(year);
                            let yearTotal = 0;
                            for (const p of yPeriods) {
                              const fVal = parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                              const iVal = parseFloat(imsMap.get(`${sku.id}-${p.id}`)?.value ?? "0") || 0;
                              yearTotal += iVal - fVal;
                            }
                            return (
                              <Fragment key={`v-${sku.id}-y-${year}`}>
                                {!isCollapsed && yPeriods.map(p => {
                                  const fVal = parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                                  const iVal = parseFloat(imsMap.get(`${sku.id}-${p.id}`)?.value ?? "0") || 0;
                                  const variance = iVal - fVal;
                                  return (
                                    <td key={`v-${sku.id}-${p.id}`} className={`px-1 py-1.5 text-right tabular-nums text-[10px] ${
                                      variance > 0 ? 'text-emerald-600 font-medium' : variance < 0 ? 'text-red-600 font-medium' : 'text-muted-foreground'
                                    }`}>
                                      {variance === 0 ? '-' : formatNumber(variance)}
                                    </td>
                                  );
                                })}
                                <td className={`px-1 py-1.5 text-right tabular-nums font-semibold border-l border-border bg-muted text-[10px] ${
                                  yearTotal > 0 ? 'text-emerald-600' : yearTotal < 0 ? 'text-red-600' : ''
                                }`}>
                                  {yearTotal === 0 ? '-' : formatNumber(yearTotal)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                          </Fragment>
                          );
                        })}
                      </Fragment>
                    ))}

                    {/* Category subtotal rows: Forecast, IMS, Variance (always visible) */}
                    <tr className={`font-semibold ${group.category === "Core" ? "bg-emerald-50" : "bg-violet-50"}`}>
                      <td className="sticky left-0 z-10 px-2 py-1" rowSpan={3} style={{ backgroundColor: group.category === "Core" ? "rgb(236 253 245)" : "rgb(245 243 255)" }}></td>
                      <td className="sticky left-[50px] z-10 px-2 py-1 whitespace-nowrap text-xs" rowSpan={3} style={{ backgroundColor: group.category === "Core" ? "rgb(236 253 245)" : "rgb(245 243 255)", color: group.category === "Core" ? "#047857" : "#6d28d9" }}>
                        Subtotal {group.category}
                      </td>
                      <td className="px-2 py-1 text-amber-600 text-[10px]">FRCST</td>
                      {periodsByYear.map(({ year, periods: yPeriods }) => {
                        const isCollapsed = collapsedYears.has(year);
                        return (
                          <Fragment key={`sf-${group.category}-${year}`}>
                            {!isCollapsed && yPeriods.map(p => (
                              <td key={`sf-${group.category}-${p.id}`} className="px-1 py-1 text-right tabular-nums text-amber-700">
                                {formatNumber(computeCatForecastTotal(group.category, p.id))}
                              </td>
                            ))}
                            <td className="px-1 py-1 text-right tabular-nums font-bold border-l border-border text-amber-700">
                              {formatNumber(computeCatForecastYearTotal(group.category, year))}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                    <tr className={`font-semibold ${group.category === "Core" ? "bg-emerald-50" : "bg-violet-50"}`}>
                      <td className="px-2 py-1 text-emerald-600 text-[10px]">IMS</td>
                      {periodsByYear.map(({ year, periods: yPeriods }) => {
                        const isCollapsed = collapsedYears.has(year);
                        return (
                          <Fragment key={`si-${group.category}-${year}`}>
                            {!isCollapsed && yPeriods.map(p => (
                              <td key={`si-${group.category}-${p.id}`} className="px-1 py-1 text-right tabular-nums text-emerald-700">
                                {formatNumber(computeCatImsTotal(group.category, p.id))}
                              </td>
                            ))}
                            <td className="px-1 py-1 text-right tabular-nums font-bold border-l border-border text-emerald-700">
                              {formatNumber(computeCatImsYearTotal(group.category, year))}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                    <tr className={`font-semibold border-b-2 ${group.category === "Core" ? "bg-emerald-50" : "bg-violet-50"}`}>
                      <td className="px-2 py-1 text-muted-foreground italic text-[10px]">Var</td>
                      {periodsByYear.map(({ year, periods: yPeriods }) => {
                        const isCollapsed = collapsedYears.has(year);
                        const fvYear = computeCatForecastYearTotal(group.category, year);
                        const ivYear = computeCatImsYearTotal(group.category, year);
                        const vYear = ivYear - fvYear;
                        return (
                          <Fragment key={`sv-${group.category}-${year}`}>
                            {!isCollapsed && yPeriods.map(p => {
                              const fv = computeCatForecastTotal(group.category, p.id);
                              const iv = computeCatImsTotal(group.category, p.id);
                              const v = iv - fv;
                              return (
                                <td key={`sv-${group.category}-${p.id}`} className={`px-1 py-1 text-right tabular-nums text-[10px] ${v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                                  {v === 0 ? '-' : formatNumber(v)}
                                </td>
                              );
                            })}
                            <td className={`px-1 py-1 text-right tabular-nums font-bold border-l border-border text-[10px] ${vYear > 0 ? 'text-emerald-600' : vYear < 0 ? 'text-red-600' : ''}`}>
                              {vYear === 0 ? '-' : formatNumber(vYear)}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}

                {/* Grand Total rows */}
                <tr className="border-t-2 border-primary bg-slate-100 font-bold">
                  <td className="sticky left-0 bg-slate-100 z-10 px-2 py-1.5" rowSpan={3}></td>
                  <td className="sticky left-[50px] bg-slate-100 z-10 px-2 py-1.5 whitespace-nowrap text-primary" rowSpan={3}>Grand Total</td>
                  <td className="px-2 py-1.5 text-amber-600 text-[10px]">FRCST</td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`gf-${year}`}>
                        {!isCollapsed && yPeriods.map(p => (
                          <td key={`gf-${p.id}`} className="px-1 py-1.5 text-right tabular-nums text-amber-700">
                            {formatNumber(computeGrandForecastTotal(p.id))}
                          </td>
                        ))}
                        <td className="px-1 py-1.5 text-right tabular-nums font-bold border-l border-border bg-slate-100 text-amber-700">
                          {formatNumber(computeGrandForecastYearTotal(year))}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
                <tr className="bg-slate-50 font-bold">
                  <td className="px-2 py-1.5 text-emerald-600 text-[10px]">IMS</td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`gi-${year}`}>
                        {!isCollapsed && yPeriods.map(p => (
                          <td key={`gi-${p.id}`} className="px-1 py-1.5 text-right tabular-nums text-emerald-700">
                            {formatNumber(computeGrandImsTotal(p.id))}
                          </td>
                        ))}
                        <td className="px-1 py-1.5 text-right tabular-nums font-bold border-l border-border bg-slate-100 text-emerald-700">
                          {formatNumber(computeGrandImsYearTotal(year))}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
                <tr className="bg-slate-50 font-bold border-b-2">
                  <td className="px-2 py-1.5 text-muted-foreground italic text-[10px]">Var</td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    const fvYear = computeGrandForecastYearTotal(year);
                    const ivYear = computeGrandImsYearTotal(year);
                    const vYear = ivYear - fvYear;
                    return (
                      <Fragment key={`gv-${year}`}>
                        {!isCollapsed && yPeriods.map(p => {
                          const fv = computeGrandForecastTotal(p.id);
                          const iv = computeGrandImsTotal(p.id);
                          const v = iv - fv;
                          return (
                            <td key={`gv-${p.id}`} className={`px-1 py-1.5 text-right tabular-nums text-[10px] ${v > 0 ? 'text-emerald-600' : v < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                              {v === 0 ? '-' : formatNumber(v)}
                            </td>
                          );
                        })}
                        <td className={`px-1 py-1.5 text-right tabular-nums font-bold border-l border-border bg-slate-100 text-[10px] ${vYear > 0 ? 'text-emerald-600' : vYear < 0 ? 'text-red-600' : ''}`}>
                          {vYear === 0 ? '-' : formatNumber(vYear)}
                        </td>
                      </Fragment>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
