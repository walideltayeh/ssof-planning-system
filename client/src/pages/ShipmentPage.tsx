import { Fragment } from "react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useMemo, useState, useCallback } from "react";
import { useGridNav } from "@/hooks/useGridNav";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

/** Compute arrival date from a production period and an offset */
export function computeArrivalDate(year: number, month: number, offsetValue: number, offsetUnit: string): Date {
  // Use the 1st of the production month as the base
  const base = new Date(year, month - 1, 1);
  if (offsetUnit === "days") {
    base.setDate(base.getDate() + offsetValue);
  } else if (offsetUnit === "weeks") {
    base.setDate(base.getDate() + offsetValue * 7);
  } else if (offsetUnit === "months") {
    base.setMonth(base.getMonth() + offsetValue);
  }
  return base;
}

export function formatArrivalDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function ShipmentPage() {
  const { user: appUser } = useAppAuth();
  const { country, config } = useCountry();
  const isLebanon = country === "Lebanon";
  const utils = trpc.useUtils();

  const { data: lbData, isLoading: lbLoading, isFetching: lbFetching, refetch: lbRefetch } = trpc.data.shipment.useQuery(undefined, { enabled: isLebanon, staleTime: 0, refetchOnWindowFocus: true });
  const { data: intlData, isLoading: intlLoading, isFetching: intlFetching, refetch: intlRefetch } = trpc.country.data.useQuery(
    { country: country as "Syria" | "Libya" },
    { enabled: !isLebanon && (country === "Syria" || country === "Libya"), staleTime: 0, refetchOnWindowFocus: true }
  );
  const data = isLebanon
    ? lbData
    : intlData ? { skus: intlData.skus, periods: intlData.periods, data: intlData.shipment } : undefined;
  const isLoading = isLebanon ? lbLoading : intlLoading;
  const isFetching = isLebanon ? lbFetching : intlFetching;
  const refetchAll = isLebanon ? lbRefetch : intlRefetch;

  const updateCellLb = trpc.update.shipmentCell.useMutation({
    onSuccess: () => {
      utils.data.shipment.invalidate();
      utils.data.planningFg.invalidate();
      utils.data.imsVsForecast.invalidate();
    },
    onError: (err) => toast.error("Failed to save: " + err.message),
  });
  const updateCellIntl = trpc.country.updateProduction.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to save: " + err.message),
  });

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<number>>(new Set());
  const [collapsedWeights, setCollapsedWeights] = useState<Set<string>>(new Set());

  // Arrival offset state per SKU-period (for Syria/Libya)
  const [offsetEditing, setOffsetEditing] = useState<string | null>(null);
  const [offsetValue, setOffsetValue] = useState<string>("");
  const [offsetUnit, setOffsetUnit] = useState<"days" | "weeks" | "months">("days");

  const toggleYear = useCallback((year: number) => {
    setCollapsedYears(prev => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }, []);

  const togglePeriod = useCallback((periodId: number) => {
    setCollapsedPeriods(prev => {
      const next = new Set(prev);
      if (next.has(periodId)) next.delete(periodId);
      else next.add(periodId);
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

  const toggleWeight = useCallback((key: string) => {
    setCollapsedWeights(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  // Map: skuId-periodId -> full shipment row (including arrivalOffset fields)
  const dataMap = useMemo(() => {
    const map = new Map<string, {
      week1: string; week2: string; week3: string; week4: string;
      arrivalOffsetValue?: number | null; arrivalOffsetUnit?: string | null;
    }>();
    if (data?.data) {
      for (const d of data.data) {
        map.set(`${d.skuId}-${d.periodId}`, {
          week1: d.week1 ?? "0", week2: d.week2 ?? "0",
          week3: d.week3 ?? "0", week4: d.week4 ?? "0",
          arrivalOffsetValue: (d as any).arrivalOffsetValue ?? 0,
          arrivalOffsetUnit: (d as any).arrivalOffsetUnit ?? "days",
        });
      }
    }
    return map;
  }, [data]);

  const allSkus = data?.skus ?? [];
  const periods = data?.periods ?? [];

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

  const groupedSkus = useMemo(() => {
    const groups: { category: string; weightGroups: { weight: string; skus: typeof sortedSkus }[] }[] = [];
    let currentCat = "";
    let currentWeight = "";
    for (const sku of sortedSkus) {
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
  }, [sortedSkus]);

  const formatNumber = (val: number) => val === 0 ? "-" : val.toLocaleString('en-US', { maximumFractionDigits: 0 });

  const handleCellClick = useCallback((cellKey: string, currentValue: string) => {
    setEditingCell(cellKey);
    setOldValue(currentValue);
    setEditValue(currentValue === "0" ? "" : currentValue);
  }, []);

  const handleCellSave = useCallback((skuId: number, periodId: number, weekKey: string) => {
    const numVal = parseFloat(editValue) || 0;
    const sku = data?.skus.find(s => s.id === skuId);
    const period = data?.periods.find(p => p.id === periodId);
    if (isLebanon) {
      updateCellLb.mutate({ skuId, periodId, [weekKey]: numVal.toString(), username: appUser?.displayName, skuName: sku?.name, periodLabel: period?.label });
    } else {
      updateCellIntl.mutate({ skuId, periodId, week1: dataMap.get(`${skuId}-${periodId}`)?.week1 ?? "0", week2: dataMap.get(`${skuId}-${periodId}`)?.week2 ?? "0", week3: dataMap.get(`${skuId}-${periodId}`)?.week3 ?? "0", week4: dataMap.get(`${skuId}-${periodId}`)?.week4 ?? "0", [weekKey]: numVal.toString(), country: country as "Syria" | "Libya", username: appUser?.displayName, skuName: sku?.name, periodLabel: period?.label });
    }
    setEditingCell(null);
  }, [editValue, updateCellLb, updateCellIntl, isLebanon, country, appUser, data, dataMap]);

  // handleCellKeyDown is defined after periodsByYear (below)

  // Save arrival offset for a Syria/Libya production entry
  const handleOffsetSave = useCallback((skuId: number, periodId: number) => {
    const sku = data?.skus.find(s => s.id === skuId);
    const period = data?.periods.find(p => p.id === periodId);
    const existing = dataMap.get(`${skuId}-${periodId}`);
    updateCellIntl.mutate({
      skuId, periodId,
      week1: existing?.week1 ?? "0",
      week2: existing?.week2 ?? "0",
      week3: existing?.week3 ?? "0",
      week4: existing?.week4 ?? "0",
      arrivalOffsetValue: parseInt(offsetValue) || 0,
      arrivalOffsetUnit: offsetUnit,
      country: country as "Syria" | "Libya",
      username: appUser?.displayName,
      skuName: sku?.name,
      periodLabel: period?.label,
    });
    setOffsetEditing(null);
  }, [offsetValue, offsetUnit, updateCellIntl, country, appUser, data, dataMap]);

  const years = Array.from(new Set(periods.map(p => p.year))).sort();
  const periodsByYear = years.map(year => ({
    year,
    periods: periods.filter(p => p.year === year).sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  // Navigable cell IDs: skuId-periodId-weekKey (only visible weeks)
  const WEEKS = ["week1", "week2", "week3", "week4"] as const;
  const navigableCellIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of groupedSkus) {
      if (collapsedCategories.has(group.category)) continue;
      for (const wg of group.weightGroups) {
        if (collapsedWeights.has(wg.weight)) continue;
        for (const sku of wg.skus) {
          for (const { year, periods: yPeriods } of periodsByYear) {
            if (collapsedYears.has(year)) continue;
            for (const p of yPeriods) {
              if (collapsedPeriods.has(p.id)) continue;
              for (const wk of WEEKS) {
                ids.push(`${sku.id}-${p.id}-${wk}`);
              }
            }
          }
        }
      }
    }
    return ids;
  }, [groupedSkus, periodsByYear, collapsedYears, collapsedPeriods, collapsedCategories, collapsedWeights]);

  // Number of visible week columns per row
  const visibleWeekColCount = useMemo(() => {
    let total = 0;
    for (const { year, periods: yPeriods } of periodsByYear) {
      if (collapsedYears.has(year)) continue;
      for (const p of yPeriods) {
        if (!collapsedPeriods.has(p.id)) total += WEEKS.length;
      }
    }
    return total;
  }, [periodsByYear, collapsedYears, collapsedPeriods]);

  const { handleNavKeyDown } = useGridNav({
    cellIds: navigableCellIds,
    editingCell,
    setEditingCell: (id) => {
      if (id === null) { setEditingCell(null); return; }
      const parts = id.split("-");
      const skuId = parseInt(parts[0]);
      const periodId = parseInt(parts[1]);
      const wk = parts[2];
      const rawVal = (dataMap.get(`${skuId}-${periodId}`)?.[wk as "week1"] ?? "0");
      setEditingCell(id);
      setOldValue(rawVal);
      setEditValue(rawVal === "0" ? "" : rawVal);
    },
    onSave: (cellId) => {
      const parts = cellId.split("-");
      handleCellSave(parseInt(parts[0]), parseInt(parts[1]), parts[2]);
    },
    onCancel: () => setEditingCell(null),
    colCount: visibleWeekColCount,
  });

  const handleCellKeyDown = useCallback((e: React.KeyboardEvent, skuId: number, periodId: number, weekKey: string) => {
    handleNavKeyDown(e, `${skuId}-${periodId}-${weekKey}`);
  }, [handleNavKeyDown]);

  const getWeekVal = (skuId: number, periodId: number, weekKey: string) => {
    const d = dataMap.get(`${skuId}-${periodId}`);
    if (!d) return 0;
    return parseFloat(d[weekKey as keyof typeof d] as string) || 0;
  };

  const getMonthTotal = (skuId: number, periodId: number) => {
    const d = dataMap.get(`${skuId}-${periodId}`);
    if (!d) return 0;
    return (parseFloat(d.week1) || 0) + (parseFloat(d.week2) || 0) + (parseFloat(d.week3) || 0) + (parseFloat(d.week4) || 0);
  };

  const getFullYearTotal = (skuId: number, yearPeriods: typeof periods) => {
    let total = 0;
    for (const p of yearPeriods) total += getMonthTotal(skuId, p.id);
    return total;
  };

  const computeCatWeekTotal = (category: string, periodId: number, weekKey: string) => {
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      total += getWeekVal(sku.id, periodId, weekKey);
    }
    return total;
  };

  const computeCatMonthTotal = (category: string, periodId: number) => {
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      total += getMonthTotal(sku.id, periodId);
    }
    return total;
  };

  const computeCatFullYearTotal = (category: string, yearPeriods: typeof periods) => {
    let total = 0;
    for (const sku of allSkus) {
      if (sku.category !== category) continue;
      total += getFullYearTotal(sku.id, yearPeriods);
    }
    return total;
  };

  const computeGrandWeekTotal = (periodId: number, weekKey: string) => {
    let total = 0;
    for (const sku of allSkus) total += getWeekVal(sku.id, periodId, weekKey);
    return total;
  };

  const computeGrandMonthTotal = (periodId: number) => {
    let total = 0;
    for (const sku of allSkus) total += getMonthTotal(sku.id, periodId);
    return total;
  };

  const computeGrandFullYearTotal = (yearPeriods: typeof periods) => {
    let total = 0;
    for (const sku of allSkus) total += getFullYearTotal(sku.id, yearPeriods);
    return total;
  };

  // For Syria/Libya: columns per period = W1+W2+W3+W4+Total+ArrivalOffset = 6, collapsed = Total only = 1
  const colsPerPeriod = isLebanon ? 5 : 6;
  const collapsedColsPerPeriod = 1; // just Total column when weeks are collapsed

  const getPeriodCols = (p: { id: number }) => collapsedPeriods.has(p.id) ? collapsedColsPerPeriod : colsPerPeriod;

  const totalColCount = useMemo(() => {
    return 2 + periodsByYear.reduce((acc, { year, periods: yPeriods }) => {
      if (collapsedYears.has(year)) return acc + 1;
      return acc + yPeriods.reduce((s, p) => s + getPeriodCols(p), 0) + 1;
    }, 0);
  }, [periodsByYear, collapsedYears, collapsedPeriods, colsPerPeriod]);

  if (isLoading) return <TableSkeleton title={config?.terms.production ?? "Shipment (Production)"} rows={10} cols={14} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{config?.terms.production ?? "Shipment (Production)"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weekly {isLebanon ? "production shipment" : "production"} data per SKU per month.
            {!isLebanon && <span className="ml-1 text-amber-600 font-medium">Set the arrival offset per batch to auto-calculate arrival dates.</span>}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCollapsedYears(new Set(years))} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors" title="Collapse all years">Collapse All</button>
          <button onClick={() => setCollapsedYears(new Set())} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors" title="Expand all years">Expand All</button>
          <button
            onClick={() => refetchAll()}
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
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-30">
                {/* Year headers */}
                <tr className="bg-muted">
                  <th className="sticky left-0 z-40 bg-muted px-2 py-2 text-left font-medium text-muted-foreground min-w-[50px] after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border">Weight</th>
                  <th className="sticky left-[50px] z-40 bg-muted px-2 py-2 text-left font-medium text-muted-foreground min-w-[180px] after:absolute after:inset-y-0 after:right-0 after:w-[2px] after:bg-border/60 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.08)]">SKU Name</th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isYearCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`year-${year}`}>
                        {!isYearCollapsed && yPeriods.map(p => {
                          const isPeriodCollapsed = collapsedPeriods.has(p.id);
                          return (
                            <th
                              key={p.id}
                              colSpan={getPeriodCols(p)}
                              className="px-1 py-1 text-center font-bold border-l border-border text-primary min-w-[60px] cursor-pointer select-none hover:bg-primary/20 transition-colors"
                              onClick={() => togglePeriod(p.id)}
                              title={isPeriodCollapsed ? `Expand ${p.label} weeks` : `Collapse ${p.label} weeks`}
                            >
                              <span className="inline-flex items-center gap-1 justify-center">
                                {isPeriodCollapsed ? "▶" : "▼"} {p.label}
                              </span>
                            </th>
                          );
                        })}
                        <th
                          className="px-2 py-1 text-center font-bold border-l-2 border-primary bg-primary/10 text-primary min-w-[70px] cursor-pointer select-none hover:bg-primary/20 transition-colors"
                          onClick={() => toggleYear(year)}
                          title={isYearCollapsed ? `Expand ${year}` : `Collapse ${year}`}
                        >
                          <span className="inline-flex items-center gap-1 justify-center">
                            {isYearCollapsed ? "▶" : "▼"} FY {year}
                          </span>
                        </th>
                      </Fragment>
                    );
                  })}
                </tr>
                {/* Week sub-headers */}
                <tr className="bg-muted/50 border-b border-border">
                  <th className="sticky left-0 z-40 bg-muted/50"></th>
                  <th className="sticky left-[50px] z-40 bg-muted/50 shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]"></th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isYearCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`week-header-${year}`}>
                        {!isYearCollapsed && yPeriods.map(p => {
                          const isPeriodCollapsed = collapsedPeriods.has(p.id);
                          return (
                            <Fragment key={`wh-${p.id}`}>
                              {!isPeriodCollapsed && ["W1","W2","W3","W4"].map(wLabel => (
                                <th key={wLabel} className="px-1 py-1 text-center font-medium text-muted-foreground border-l border-border/50 min-w-[50px]">{wLabel}</th>
                              ))}
                              <th className="px-1 py-1 text-center font-bold text-amber-800 border-l-2 border-amber-400 bg-amber-50 min-w-[50px]">Total</th>
                              {!isLebanon && !isPeriodCollapsed && (
                                <th className="px-1 py-1 text-center font-medium text-amber-600 border-l border-border/50 min-w-[90px]">Arrival</th>
                              )}
                            </Fragment>
                          );
                        })}
                        <th className="border-l-2 border-primary"></th>
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedSkus.map(({ category, weightGroups }) => {
                  const isCatCollapsed = collapsedCategories.has(category);
                  return (
                    <Fragment key={category}>
                      {/* Category header row */}
                      <tr className="bg-muted/30 border-y border-border cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => toggleCategory(category)}>
                        <td colSpan={totalColCount} className="px-3 py-1.5 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            {isCatCollapsed ? "▶" : "▼"} {category}
                          </span>
                        </td>
                      </tr>
                      {!isCatCollapsed && weightGroups.map(({ weight, skus: weightSkus }) => (
                        <Fragment key={`wg-${category}-${weight}`}>
                          {/* Weight group header */}
                          <tr className="bg-slate-100 cursor-pointer select-none hover:bg-slate-200 transition-colors" onClick={() => toggleWeight(`${category}-${weight}`)}>
                            <td colSpan={totalColCount} className="px-4 py-1 text-xs font-semibold text-slate-600 sticky left-0 z-10">
                              <span className="inline-flex items-center gap-2">
                                <svg className={`w-3 h-3 transition-transform duration-200 ${collapsedWeights.has(`${category}-${weight}`) ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                </svg>
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  weight === '50g' ? 'bg-blue-100 text-blue-700' :
                                  weight === '250g' ? 'bg-amber-100 text-amber-700' :
                                  'bg-rose-100 text-rose-700'
                                }`}>{weight}</span>
                                <span className="text-[10px] text-muted-foreground font-normal">{weightSkus.length} SKUs{collapsedWeights.has(`${category}-${weight}`) ? ' — collapsed' : ''}</span>
                              </span>
                            </td>
                          </tr>
                          {!collapsedWeights.has(`${category}-${weight}`) && weightSkus.map(sku => (
                        <tr key={sku.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="sticky left-0 z-10 bg-background px-2 py-1.5 after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border/40">
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
                          <td className="sticky left-[50px] z-10 bg-background px-2 py-1.5 font-medium max-w-[180px] truncate shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]" title={sku.name}>{sku.name}</td>
                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            const isYearCollapsed = collapsedYears.has(year);
                            const yearTotal = getFullYearTotal(sku.id, yPeriods);
                            return (
                              <Fragment key={`sku-${sku.id}-year-${year}`}>
                                {!isYearCollapsed && yPeriods.map(p => {
                                  const monthTotal = getMonthTotal(sku.id, p.id);
                                  const offsetData = dataMap.get(`${sku.id}-${p.id}`);
                                  const offVal = offsetData?.arrivalOffsetValue ?? 0;
                                  const offUnit = (offsetData?.arrivalOffsetUnit ?? "days") as "days" | "weeks" | "months";
                                  const hasOffset = offVal > 0;
                                  const arrivalDate = hasOffset ? computeArrivalDate(p.year, p.month, offVal, offUnit) : null;
                                  const offsetKey = `${sku.id}-${p.id}`;
                                  const isEditingOffset = offsetEditing === offsetKey;

                                  const isPeriodCollapsed = collapsedPeriods.has(p.id);
                                  return (
                                    <Fragment key={`cell-${sku.id}-${p.id}`}>
                                      {!isPeriodCollapsed && ["week1","week2","week3","week4"].map((wk, idx) => {
                                        const cellKey = `${sku.id}-${p.id}-${wk}`;
                                        const val = getWeekVal(sku.id, p.id, wk);
                                        const isEditing = editingCell === cellKey;
                                        return (
                                          <td key={wk} className={`px-1 py-1 text-right border-l ${idx === 0 ? "border-border" : "border-border/30"} min-w-[50px]`}>
                                            {isEditing ? (
                                              <input
                                                type="number"
                                                className="w-full text-right bg-primary/10 border border-primary rounded px-1 py-0.5 text-xs focus:outline-none"
                                                value={editValue}
                                                autoFocus
                                                onChange={e => setEditValue(e.target.value)}
                                                onBlur={() => handleCellSave(sku.id, p.id, wk)}
                                                onKeyDown={e => handleCellKeyDown(e, sku.id, p.id, wk)}
                                              />
                                            ) : (
                                              <span
                                                className="cursor-pointer hover:bg-primary/10 rounded px-1 py-0.5 transition-colors block text-right"
                                                onClick={() => handleCellClick(cellKey, val.toString())}
                                              >
                                                {formatNumber(val)}
                                              </span>
                                            )}
                                          </td>
                                        );
                                      })}
                                      {/* Month total */}
                                      <td className="px-1 py-1 text-right border-l-2 border-amber-400 bg-amber-50 font-bold text-amber-900 min-w-[50px]">
                                        {formatNumber(monthTotal)}
                                      </td>
                                      {/* Arrival offset column (Syria/Libya only) */}
                                      {!isLebanon && !isPeriodCollapsed && (
                                        <td className="px-1 py-1 text-center border-l border-border/30 min-w-[90px]">
                                          {isEditingOffset ? (
                                            <div className="flex items-center gap-0.5">
                                              <input
                                                type="number"
                                                min={0}
                                                className="w-10 text-right bg-amber-50 border border-amber-400 rounded px-1 py-0.5 text-xs focus:outline-none"
                                                value={offsetValue}
                                                autoFocus
                                                onChange={e => setOffsetValue(e.target.value)}
                                                onKeyDown={e => { if (e.key === "Enter") handleOffsetSave(sku.id, p.id); if (e.key === "Escape") setOffsetEditing(null); }}
                                              />
                                              <select
                                                className="text-[10px] border border-amber-400 rounded px-0.5 py-0.5 bg-amber-50 focus:outline-none"
                                                value={offsetUnit}
                                                onChange={e => setOffsetUnit(e.target.value as "days" | "weeks" | "months")}
                                              >
                                                <option value="days">d</option>
                                                <option value="weeks">w</option>
                                                <option value="months">m</option>
                                              </select>
                                              <button onClick={() => handleOffsetSave(sku.id, p.id)} className="text-[10px] bg-amber-500 text-white rounded px-1 py-0.5 hover:bg-amber-600">✓</button>
                                            </div>
                                          ) : (
                                            <button
                                              className={`text-[10px] rounded px-1.5 py-0.5 transition-colors w-full text-center ${hasOffset ? "bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium" : "text-muted-foreground hover:bg-muted"}`}
                                              onClick={() => {
                                                setOffsetEditing(offsetKey);
                                                setOffsetValue(offVal > 0 ? offVal.toString() : (country === "Libya" ? "30" : ""));
                                                setOffsetUnit(offUnit);
                                              }}
                                              title="Set arrival offset"
                                            >
                                              {hasOffset
                                                ? `+${offVal}${offUnit === "days" ? "d" : offUnit === "weeks" ? "w" : "m"} → ${arrivalDate ? formatArrivalDate(arrivalDate) : ""}`
                                                : "Set offset"}
                                            </button>
                                          )}
                                        </td>
                                      )}
                                    </Fragment>
                                  );
                                })}
                                {/* Full Year total */}
                                <td className="px-2 py-1 text-right border-l-2 border-primary bg-primary/5 font-bold text-primary min-w-[70px]">
                                  {formatNumber(yearTotal)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                          ))}
                        </Fragment>
                      ))}
                      {/* Category subtotal row */}
                      {!isCatCollapsed && (
                        <tr className="bg-muted/20 border-y border-border font-semibold">
                          <td className="sticky left-0 z-10 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground shadow-[2px_0_4px_-1px_rgba(0,0,0,0.06)]" colSpan={2}>{category} Total</td>
                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            const isYearCollapsed = collapsedYears.has(year);
                            return (
                              <Fragment key={`cat-total-${category}-${year}`}>
                                {!isYearCollapsed && yPeriods.map(p => {
                                  const isPeriodCollapsed = collapsedPeriods.has(p.id);
                                  return (
                                    <Fragment key={`cat-total-${category}-${p.id}`}>
                                      {!isPeriodCollapsed && ["week1","week2","week3","week4"].map((wk, idx) => (
                                        <td key={wk} className={`px-1 py-1 text-right border-l ${idx === 0 ? "border-border" : "border-border/30"} text-muted-foreground`}>
                                          {formatNumber(computeCatWeekTotal(category, p.id, wk))}
                                        </td>
                                      ))}
                                      <td className="px-1 py-1 text-right border-l-2 border-amber-400 bg-amber-50 font-bold text-amber-900">
                                        {formatNumber(computeCatMonthTotal(category, p.id))}
                                      </td>
                                      {!isLebanon && !isPeriodCollapsed && <td className="border-l border-border/30"></td>}
                                    </Fragment>
                                  );
                                })}
                                <td className="px-2 py-1 text-right border-l-2 border-primary bg-primary/5 font-bold text-primary">
                                  {formatNumber(computeCatFullYearTotal(category, yPeriods))}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {/* Grand total row */}
                <tr className="bg-primary/10 border-t-2 border-primary font-bold text-primary">
                  <td className="sticky left-0 z-10 bg-primary/10 px-2 py-2 text-[11px] shadow-[2px_0_4px_-1px_rgba(0,0,0,0.08)]" colSpan={2}>Grand Total</td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isYearCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`grand-total-${year}`}>
                        {!isYearCollapsed && yPeriods.map(p => {
                          const isPeriodCollapsed = collapsedPeriods.has(p.id);
                          return (
                            <Fragment key={`grand-total-${p.id}`}>
                              {!isPeriodCollapsed && ["week1","week2","week3","week4"].map((wk, idx) => (
                                <td key={wk} className={`px-1 py-2 text-right border-l ${idx === 0 ? "border-border" : "border-border/30"}`}>
                                  {formatNumber(computeGrandWeekTotal(p.id, wk))}
                                </td>
                              ))}
                              <td className="px-1 py-2 text-right border-l-2 border-amber-400 bg-amber-100 font-bold text-amber-900">{formatNumber(computeGrandMonthTotal(p.id))}</td>
                              {!isLebanon && !isPeriodCollapsed && <td className="border-l border-border/30"></td>}
                            </Fragment>
                          );
                        })}
                        <td className="px-2 py-2 text-right border-l-2 border-primary bg-primary/10">
                          {formatNumber(computeGrandFullYearTotal(yPeriods))}
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
