import { Fragment } from "react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useMemo, useState, useCallback } from "react";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import ExportSheetButton from "@/components/ExportSheetButton";
import ImportSheetButton from "@/components/ImportSheetButton";

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

/**
 * Forecast vs Actual page (Syria, Libya, KSA)
 * Compares the original Forecast Production (read-only) against the Actual Production figure (editable).
 * Variance = Actual - Forecast
 */
export default function ForecastVsForecastPage() {
  const { user: appUser } = useAppAuth();
  const { country } = useCountry();
  const { formatVal, unitLabel } = useUnit();
  const utils = trpc.useUtils();

  const { data: intlData, isLoading } = trpc.country.data.useQuery(
    { country: country as "Syria" | "Libya" | "KSA" },
    { enabled: country === "Syria" || country === "Libya" || country === "KSA", staleTime: 0, refetchOnWindowFocus: true }
  );

  const updateActualProduction = trpc.country.updateActualProduction.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to save: " + err.message),
  });

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [collapsedWeights, setCollapsedWeights] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [weightFilter, setWeightFilter] = useState<string>("All");

  const toggleYear = useCallback((year: number) => {
    setCollapsedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year); else next.add(year);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category); else next.add(category);
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

  // Build maps
  const forecastMap = useMemo(() => {
    const map = new Map<string, string>();
    if (intlData?.forecast) {
      for (const d of intlData.forecast) map.set(`${d.skuId}-${d.periodId}`, d.value ?? "0");
    }
    return map;
  }, [intlData]);

  const actualMap = useMemo(() => {
    const map = new Map<string, string>();
    // Auto-actual: the weekly production entered (sum of shipment weeks) shows
    // as Actual Production. A manual Actual entry (> 0) overrides it. Per user
    // direction — entered production automatically appears as Actual.
    for (const d of ((intlData as any)?.shipment ?? [])) {
      const sum = (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0)
        + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
      if (sum > 0) map.set(`${d.skuId}-${d.periodId}`, String(sum));
    }
    if (intlData?.actualProduction) {
      for (const d of intlData.actualProduction) {
        if ((parseFloat(d.value ?? "0") || 0) > 0) map.set(`${d.skuId}-${d.periodId}`, d.value ?? "0");
      }
    }
    return map;
  }, [intlData]);

  const allSkus = intlData?.skus ?? [];
  const periods = intlData?.periods ?? [];
  const years = Array.from(new Set(periods.map(p => p.year))).sort();
  const periodsByYear = years.map(year => ({
    year,
    periods: periods.filter(p => p.year === year).sort((a, b) => a.sortOrder - b.sortOrder),
  }));

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

  const filteredSkus = useMemo(() => {
    return sortedSkus.filter(sku => {
      if (searchQuery && !sku.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (weightFilter !== "All" && sku.weight !== weightFilter) return false;
      return true;
    });
  }, [sortedSkus, searchQuery, weightFilter]);

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

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return "text-emerald-600";
    if (variance < 0) return "text-red-600";
    return "text-muted-foreground";
  };

  const handleCellClick = useCallback((cellKey: string, currentValue: string) => {
    setEditingCell(cellKey);
    setOldValue(currentValue);
    setEditValue(currentValue === "0" ? "" : currentValue);
  }, []);

  const handleCellSave = useCallback((skuId: number, periodId: number) => {
    const numVal = parseFloat(editValue) || 0;
    const sku = intlData?.skus.find(s => s.id === skuId);
    const period = intlData?.periods.find(p => p.id === periodId);
    updateActualProduction.mutate({
      skuId, periodId, value: numVal.toString(),
      country: country as "Syria" | "Libya" | "KSA",
      skuName: sku?.name,
      periodLabel: period?.label,
      oldValue,
    });
    setEditingCell(null);
  }, [editValue, updateActualProduction, oldValue, intlData, appUser, country]);

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, skuId: number, periodId: number) => {
    if (e.key === "Enter") handleCellSave(skuId, periodId);
    else if (e.key === "Escape") setEditingCell(null);
  }, [handleCellSave]);

  // Totals
  const computeCatTotal = (category: string, periodId: number, map: Map<string, string>) => {
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      total += parseFloat(map.get(`${sku.id}-${periodId}`) ?? "0") || 0;
    }
    return total;
  };

  const computeGrandTotal = (periodId: number, map: Map<string, string>) => {
    let total = 0;
    for (const sku of allSkus) total += parseFloat(map.get(`${sku.id}-${periodId}`) ?? "0") || 0;
    return total;
  };

  const computeCatYearTotal = (category: string, year: number, map: Map<string, string>) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      for (const p of yPeriods) total += parseFloat(map.get(`${sku.id}-${p.id}`) ?? "0") || 0;
    }
    return total;
  };

  const computeGrandYearTotal = (year: number, map: Map<string, string>) => {
    const yPeriods = periods.filter(p => p.year === year);
    let total = 0;
    for (const sku of allSkus) {
      for (const p of yPeriods) total += parseFloat(map.get(`${sku.id}-${p.id}`) ?? "0") || 0;
    }
    return total;
  };

  const totalColCount = 3 + periodsByYear.reduce((acc, py) => {
    if (collapsedYears.has(py.year)) return acc + 1;
    return acc + py.periods.length + 1;
  }, 0);

  if (isLoading) return <TableSkeleton title="Forecast Production vs Actual" rows={10} cols={14} />;
  if (country !== "Syria" && country !== "Libya" && country !== "KSA") {
    return <div className="p-4 text-sm text-muted-foreground">This page is only available for Syria, Libya, and KSA.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Forecast Production vs Actual</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Plan = upfront production target. Actual = what was actually produced. Click Actual cells to edit.
            <span className="inline-block w-3 h-3 bg-amber-50 border border-amber-200 rounded-sm align-middle mx-1 ml-2"></span>Forecast
            <span className="inline-block w-3 h-3 bg-sky-50 border border-sky-200 rounded-sm align-middle mx-1 ml-2"></span>Actual Production
            <span className="inline-block w-3 h-3 bg-slate-100 border border-slate-200 rounded-sm align-middle mx-1 ml-2"></span>Variance
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ImportSheetButton sheet="forecast-vs-actual" country={country} label="Import Actual" />
          <ExportSheetButton sheet="forecast-vs-actual" country={country} label="Export Actual" />
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-wrap items-center gap-2">
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
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium">Weight:</span>
          {["All", "1kg", "250g", "50g"].map(w => (
            <button
              key={w}
              onClick={() => setWeightFilter(w)}
              className={`px-2 py-1 text-[10px] font-medium rounded border transition-colors ${weightFilter === w ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background hover:bg-muted"}`}
            >{w}</button>
          ))}
        </div>
        <div className="flex items-center gap-1 ml-auto">
          <button onClick={() => setCollapsedYears(new Set(years))} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors">Collapse All</button>
          <button onClick={() => setCollapsedYears(new Set())} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors">Expand All</button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[75vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                {/* Year headers */}
                <tr className="bg-muted">
                  <th className="sticky left-0 bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[50px]">Weight</th>
                  <th className="sticky left-[50px] bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[180px]">SKU Name</th>
                  <th className="sticky left-[230px] bg-muted z-30 px-2 py-2 text-left font-medium text-muted-foreground min-w-[90px]">Row</th>
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
                          <svg className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          {year}
                        </span>
                      </th>
                    );
                  })}
                </tr>
                {/* Month sub-headers */}
                <tr className="bg-muted border-b">
                  <th className="sticky left-0 bg-muted z-30 px-2 py-1"></th>
                  <th className="sticky left-[50px] bg-muted z-30 px-2 py-1"></th>
                  <th className="sticky left-[230px] bg-muted z-30 px-2 py-1"></th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`sub-${year}`}>
                        {!isCollapsed && yPeriods.map(p => (
                          <th key={p.id} className="px-1 py-1 text-center text-muted-foreground min-w-[60px] text-[10px]">{p.label.split(" ")[0]}</th>
                        ))}
                        <th className="px-1 py-1 text-center font-bold border-l-2 border-amber-300 bg-amber-50 text-amber-800 min-w-[70px] text-[10px]">
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
                    {/* Category header */}
                    <tr
                      className={`${group.category === "Core" ? "bg-emerald-50" : "bg-violet-50"} cursor-pointer select-none hover:brightness-95 transition-all`}
                      onClick={() => toggleCategory(group.category)}
                    >
                      <td colSpan={totalColCount}
                        className="px-3 py-1.5 font-bold text-xs tracking-wider uppercase sticky left-0 z-10"
                        style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}
                      >
                        <span className="inline-flex items-center gap-2">
                          <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsedCategories.has(group.category) ? "" : "rotate-90"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          {group.category}
                          <span className="font-normal normal-case text-[10px] text-muted-foreground">
                            ({group.weightGroups.reduce((s, wg) => s + wg.skus.length, 0)} SKUs){collapsedCategories.has(group.category) ? " — collapsed" : ""}
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
                        {!collapsedWeights.has(`${group.category}-${weight}`) && weightSkus.map((sku, idx) => {
                          const rowBg = idx % 2 === 1 ? "bg-slate-50" : "bg-background";
                          return (
                        <Fragment key={`sku-${sku.id}`}>
                          {/* Forecast Production row */}
                          <tr className={`border-b ${rowBg}`}>
                            <td className={`sticky left-0 z-10 ${rowBg} px-2 py-1.5`} rowSpan={3}>
                              <div className="flex flex-col items-start gap-0.5">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  sku.weight === "50g" ? "bg-blue-100 text-blue-700" :
                                  sku.weight === "250g" ? "bg-amber-100 text-amber-700" :
                                  "bg-rose-100 text-rose-700"
                                }`}>{sku.weight}</span>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  ((sku as any).packagingType ?? 'New') === 'New' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-700'
                                }`}>{(sku as any).packagingType ?? 'New'}</span>
                              </div>
                            </td>
                            <td className={`sticky left-[50px] z-10 ${rowBg} px-2 py-1.5 font-medium whitespace-nowrap`} rowSpan={3}>{sku.name}</td>
                            <td className="sticky left-[230px] z-10 bg-amber-50 px-2 py-1.5 text-amber-700 font-medium text-[10px] whitespace-nowrap border-r border-amber-200">Forecast</td>
                            {periodsByYear.map(({ year, periods: yPeriods }) => {
                              const isYearCollapsed = collapsedYears.has(year);
                              const yearTotal = yPeriods.reduce((s, p) => s + (parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0), 0);
                              return (
                                <Fragment key={`fc-${sku.id}-y${year}`}>
                                  {!isYearCollapsed && yPeriods.map(p => {
                                    const val = parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                                    return <td key={`fc-${sku.id}-${p.id}`} className="px-1 py-1.5 text-right tabular-nums bg-amber-50">{formatNumber(val)}</td>;
                                  })}
                                  <td className="px-1 py-1.5 text-right tabular-nums font-semibold border-l border-border bg-amber-50">{formatNumber(yearTotal)}</td>
                                </Fragment>
                              );
                            })}
                          </tr>

                          {/* Actual Production row (editable) */}
                          <tr className={`border-b ${rowBg}`}>
                            <td className="sticky left-[230px] z-10 bg-sky-50 px-2 py-1.5 text-sky-700 font-medium text-[10px] whitespace-nowrap border-r border-sky-200">Actual</td>
                            {periodsByYear.map(({ year, periods: yPeriods }) => {
                              const isYearCollapsed = collapsedYears.has(year);
                              const yearTotal = yPeriods.reduce((s, p) => s + (parseFloat(actualMap.get(`${sku.id}-${p.id}`) ?? "0") || 0), 0);
                              return (
                                <Fragment key={`rv-${sku.id}-y${year}`}>
                                  {!isYearCollapsed && yPeriods.map(p => {
                                    const cellKey = `${sku.id}-${p.id}`;
                                    const rawVal = actualMap.get(cellKey) ?? "0";
                                    const numVal = parseFloat(rawVal) || 0;
                                    const isEditing = editingCell === cellKey;
                                    if (isEditing) {
                                      return (
                                        <td key={cellKey} className="px-0.5 py-0.5 bg-sky-50">
                                          <input
                                            type="number"
                                            value={editValue}
                                            onChange={e => setEditValue(e.target.value)}
                                            onBlur={() => handleCellSave(sku.id, p.id)}
                                            onKeyDown={e => handleCellKeyDown(e, sku.id, p.id)}
                                            autoFocus
                                            className="w-full px-1 py-0.5 text-right text-xs border border-sky-400 rounded bg-sky-50 focus:outline-none focus:ring-1 focus:ring-sky-400"
                                          />
                                        </td>
                                      );
                                    }
                                    return (
                                      <td
                                        key={cellKey}
                                        className="px-1 py-1.5 text-right tabular-nums cursor-pointer hover:bg-sky-100 transition-colors bg-sky-50"
                                        onClick={() => handleCellClick(cellKey, rawVal)}
                                      >{formatNumber(numVal)}</td>
                                    );
                                  })}
                                  <td className="px-1 py-1.5 text-right tabular-nums font-semibold border-l border-border bg-sky-50">{formatNumber(yearTotal)}</td>
                                </Fragment>
                              );
                            })}
                          </tr>

                          {/* Variance row */}
                          <tr className={`border-b-2 ${rowBg}`}>
                            <td className="sticky left-[230px] z-10 bg-slate-100 px-2 py-1.5 text-slate-500 font-medium text-[10px] whitespace-nowrap border-r border-slate-200">Variance</td>
                            {periodsByYear.map(({ year, periods: yPeriods }) => {
                              const isYearCollapsed = collapsedYears.has(year);
                              const fcYear = yPeriods.reduce((s, p) => s + (parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0), 0);
                              const rvYear = yPeriods.reduce((s, p) => s + (parseFloat(actualMap.get(`${sku.id}-${p.id}`) ?? "0") || 0), 0);
                              const varYear = rvYear - fcYear;
                              return (
                                <Fragment key={`var-${sku.id}-y${year}`}>
                                  {!isYearCollapsed && yPeriods.map(p => {
                                    const fc = parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                                    const rv = parseFloat(actualMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                                    const variance = rv - fc;
                                    return (
                                      <td key={`var-${sku.id}-${p.id}`} className={`px-1 py-1.5 text-right tabular-nums bg-slate-100 ${getVarianceColor(variance)}`}>
                                        {variance === 0 ? "-" : (variance > 0 ? "+" : "") + formatNumber(variance)}
                                      </td>
                                    );
                                  })}
                                  <td className={`px-1 py-1.5 text-right tabular-nums font-semibold border-l border-border bg-slate-100 ${getVarianceColor(varYear)}`}>
                                    {varYear === 0 ? "-" : (varYear > 0 ? "+" : "") + formatNumber(varYear)}
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

                    {/* Category subtotals */}
                    {(["Forecast", "Actual", "Variance"] as const).map(rowType => (
                      <tr key={`subtot-${group.category}-${rowType}`} className={`font-semibold ${group.category === "Core" ? "bg-emerald-50" : "bg-violet-50"} ${rowType === "Variance" ? "border-b-2" : "border-b"}`}>
                        <td className="sticky left-0 z-10 px-2 py-1.5" style={{ backgroundColor: group.category === "Core" ? "rgb(236 253 245)" : "rgb(245 243 255)" }}></td>
                        <td className="sticky left-[50px] z-10 px-2 py-1.5 whitespace-nowrap text-xs" style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}>
                          Subtotal {group.category}
                        </td>
                        <td className="sticky left-[230px] z-10 px-2 py-1.5 text-[10px] font-medium text-muted-foreground" style={{ backgroundColor: group.category === "Core" ? "rgb(236 253 245)" : "rgb(245 243 255)" }}>
                          {rowType}
                        </td>
                        {periodsByYear.map(({ year, periods: yPeriods }) => {
                          const isYearCollapsed = collapsedYears.has(year);
                          return (
                            <Fragment key={`subtot-${group.category}-${rowType}-${year}`}>
                              {!isYearCollapsed && yPeriods.map(p => {
                                const fc = computeCatTotal(group.category, p.id, forecastMap);
                                const rv = computeCatTotal(group.category, p.id, actualMap);
                                const val = rowType === "Forecast" ? fc : rowType === "Actual" ? rv : rv - fc;
                                return (
                                  <td key={`subtot-${group.category}-${rowType}-${p.id}`}
                                    className={`px-1 py-1.5 text-right tabular-nums ${rowType === "Variance" ? getVarianceColor(val) : ""}`}
                                    style={{ color: rowType !== "Variance" ? (group.category === "Core" ? "#047857" : "#6d28d9") : undefined }}
                                  >
                                    {rowType === "Variance"
                                      ? (val === 0 ? "-" : (val > 0 ? "+" : "") + formatNumber(val))
                                      : formatNumber(val)}
                                  </td>
                                );
                              })}
                              {(() => {
                                const fcY = computeCatYearTotal(group.category, year, forecastMap);
                                const rvY = computeCatYearTotal(group.category, year, actualMap);
                                const val = rowType === "Forecast" ? fcY : rowType === "Actual" ? rvY : rvY - fcY;
                                return (
                                  <td className={`px-1 py-1.5 text-right tabular-nums font-bold border-l-2 border-amber-300 bg-amber-50 ${rowType === "Variance" ? getVarianceColor(val) : "text-amber-900"}`}>
                                    {rowType === "Variance"
                                      ? (val === 0 ? "-" : (val > 0 ? "+" : "") + formatNumber(val))
                                      : formatNumber(val)}
                                  </td>
                                );
                              })()}
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}

                {/* Grand Total rows */}
                {(["Forecast", "Actual", "Variance"] as const).map(rowType => (
                  <tr key={`gt-${rowType}`} className={`border-t-2 ${rowType === "Forecast" ? "border-primary" : ""} bg-slate-100 font-bold`}>
                    <td className="sticky left-0 bg-slate-100 z-10 px-2 py-2"></td>
                    <td className="sticky left-[50px] bg-slate-100 z-10 px-2 py-2 whitespace-nowrap text-primary">
                      {rowType === "Forecast" ? "Grand Total" : ""}
                    </td>
                    <td className="sticky left-[230px] bg-slate-100 z-10 px-2 py-2 text-[10px] font-medium text-muted-foreground">{rowType}</td>
                    {periodsByYear.map(({ year, periods: yPeriods }) => {
                      const isYearCollapsed = collapsedYears.has(year);
                      return (
                        <Fragment key={`gt-${rowType}-y${year}`}>
                          {!isYearCollapsed && yPeriods.map(p => {
                            const fc = computeGrandTotal(p.id, forecastMap);
                            const rv = computeGrandTotal(p.id, actualMap);
                            const val = rowType === "Forecast" ? fc : rowType === "Actual" ? rv : rv - fc;
                            return (
                              <td key={`gt-${rowType}-${p.id}`} className={`px-1 py-2 text-right tabular-nums ${rowType === "Variance" ? getVarianceColor(val) : "text-primary"}`}>
                                {rowType === "Variance"
                                  ? (val === 0 ? "-" : (val > 0 ? "+" : "") + formatNumber(val))
                                  : formatNumber(val)}
                              </td>
                            );
                          })}
                          {(() => {
                            const fcY = computeGrandYearTotal(year, forecastMap);
                            const rvY = computeGrandYearTotal(year, actualMap);
                            const val = rowType === "Forecast" ? fcY : rowType === "Actual" ? rvY : rvY - fcY;
                            return (
                              <td className={`px-1 py-2 text-right tabular-nums font-bold border-l-2 border-amber-400 bg-amber-100 ${rowType === "Variance" ? getVarianceColor(val) : "text-amber-900"}`}>
                                {rowType === "Variance"
                                  ? (val === 0 ? "-" : (val > 0 ? "+" : "") + formatNumber(val))
                                  : formatNumber(val)}
                              </td>
                            );
                          })()}
                        </Fragment>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
