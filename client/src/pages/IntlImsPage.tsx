import { Fragment, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useGridNav } from "@/hooks/useGridNav";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import ExportSheetButton from "@/components/ExportSheetButton";
import ImportSheetButton from "@/components/ImportSheetButton";

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

export default function IntlImsPage() {
  const { user: appUser } = useAppAuth();
  const { country, config } = useCountry();
  const { formatVal, unitLabel } = useUnit();
  const utils = trpc.useUtils();

  const { data, isLoading, isFetching, refetch } = trpc.country.data.useQuery(
    { country: country as "Syria" | "Libya" },
    { enabled: country === "Syria" || country === "Libya", staleTime: 0, refetchOnWindowFocus: true }
  );

  const updateIms = trpc.country.updateIms.useMutation({
    onSuccess: () => {
      utils.country.data.invalidate();
      utils.country.planningFg.invalidate();
    },
    onError: (err: any) => toast.error("Failed to save: " + err.message),
  });

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const skipBlurRef = useRef(false);
  const [editValue, setEditValue] = useState("");
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  const toggleYear = useCallback((year: number) => {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  // IMS data map: skuId-periodId → value
  const imsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.ims ?? []) {
      m.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
    }
    return m;
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
    const groups: { category: string; skus: typeof sortedSkus }[] = [];
    let currentCat = "";
    for (const sku of sortedSkus) {
      if (sku.category !== currentCat) {
        currentCat = sku.category;
        groups.push({ category: currentCat, skus: [] });
      }
      groups[groups.length - 1].skus.push(sku);
    }
    return groups;
  }, [sortedSkus]);

  const years = useMemo(() => Array.from(new Set(periods.map((p) => p.year))).sort(), [periods]);
  const periodsByYear = useMemo(
    () => years.map((year) => ({ year, periods: periods.filter((p) => p.year === year).sort((a, b) => a.sortOrder - b.sortOrder) })),
    [years, periods]
  );

  const formatNumber = (val: number) => val === 0 ? "-" : formatVal(val);

  const getVal = useCallback(
    (skuId: number, periodId: number) => imsMap.get(`${skuId}-${periodId}`) ?? 0,
    [imsMap]
  );

  const getYearTotal = useCallback(
    (skuId: number, yearPeriods: typeof periods) =>
      yearPeriods.reduce((sum, p) => sum + getVal(skuId, p.id), 0),
    [getVal]
  );

  const getCatMonthTotal = useCallback(
    (category: string, periodId: number) =>
      allSkus.filter((s) => s.category === category).reduce((sum, s) => sum + getVal(s.id, periodId), 0),
    [allSkus, getVal]
  );

  const getCatYearTotal = useCallback(
    (category: string, yearPeriods: typeof periods) =>
      allSkus.filter((s) => s.category === category).reduce((sum, s) => sum + getYearTotal(s.id, yearPeriods), 0),
    [allSkus, getYearTotal]
  );

  const getGrandMonthTotal = useCallback(
    (periodId: number) => allSkus.reduce((sum, s) => sum + getVal(s.id, periodId), 0),
    [allSkus, getVal]
  );

  const getGrandYearTotal = useCallback(
    (yearPeriods: typeof periods) => allSkus.reduce((sum, s) => sum + getYearTotal(s.id, yearPeriods), 0),
    [allSkus, getYearTotal]
  );

  const totalColCount = useMemo(() => {
    return 2 + periodsByYear.reduce((acc, { year, periods: yp }) => {
      return acc + (collapsedYears.has(year) ? 1 : yp.length + 1);
    }, 0);
  }, [periodsByYear, collapsedYears]);

  const handleCellClick = useCallback((cellKey: string, currentValue: number) => {
    setEditingCell(cellKey);
    setEditValue(currentValue === 0 ? "" : currentValue.toString());
  }, []);

  const handleCellSave = useCallback(
    (skuId: number, periodId: number) => {
      const numVal = parseFloat(editValue) || 0;
      const sku = allSkus.find((s) => s.id === skuId);
      const period = periods.find((p) => p.id === periodId);
      updateIms.mutate({
        skuId,
        periodId,
        value: numVal.toString(),
        country: country as "Syria" | "Libya",
        username: appUser?.displayName,
        skuName: sku?.name,
        periodLabel: period?.label,
      });
      setEditingCell(null);
    },
    [editValue, updateIms, allSkus, periods, country, appUser]
  );

  // Build navigable cell IDs for IMS grid
  const navigableCellIds = useMemo(() => {
    const visiblePeriods = periodsByYear
      .filter(({ year }) => !collapsedYears.has(year))
      .flatMap(({ periods: yp }) => yp);
    const ids: string[] = [];
    for (const group of groupedSkus) {
      if (collapsedCategories.has(group.category)) continue;
      for (const sku of group.skus) {
        for (const p of visiblePeriods) {
          ids.push(`${sku.id}-${p.id}`);
        }
      }
    }
    return ids;
  }, [groupedSkus, periodsByYear, collapsedYears, collapsedCategories]);

  const visiblePeriodCount = useMemo(() =>
    periodsByYear.filter(({ year }) => !collapsedYears.has(year)).flatMap(({ periods: yp }) => yp).length,
    [periodsByYear, collapsedYears]
  );

  const { handleNavKeyDown } = useGridNav({
    cellIds: navigableCellIds,
    editingCell,
    setEditingCell: (id) => {
      if (id === null) { setEditingCell(null); return; }
      const parts = id.split("-");
      const skuId = parseInt(parts[0]);
      const periodId = parseInt(parts[1]);
      const val = imsMap.get(`${skuId}-${periodId}`) ?? 0;
      setEditingCell(id);
      setEditValue(val === 0 ? "" : val.toString());
    },
    onSave: (cellId) => {
      const parts = cellId.split("-");
      handleCellSave(parseInt(parts[0]), parseInt(parts[1]));
      skipBlurRef.current = true;
    },
    onCancel: () => setEditingCell(null),
    colCount: visiblePeriodCount,
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, skuId: number, periodId: number) => {
      handleNavKeyDown(e, `${skuId}-${periodId}`);
    },
    [handleNavKeyDown]
  );

  if (isLoading) return <TableSkeleton title="IMS" rows={10} cols={14} />;

  if (allSkus.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <p className="text-lg font-medium mb-2">No SKUs found for {country}</p>
            <p className="text-sm">Go to SKU Management to create SKUs first.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {config?.terms.ims ?? "IMS"} — {country}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Monthly IMS (Inventory Management System / actual offtake) per SKU. Click any cell to edit.
            IMS values feed directly into Planning FG as the consumption row.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsedYears(new Set(years))}
            className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
          >
            Collapse All
          </button>
          <button
            onClick={() => setCollapsedYears(new Set())}
            className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded border border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Sync all data from server"
          >
            <svg className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isFetching ? 'Syncing...' : 'Sync All'}
          </button>
          <ImportSheetButton sheet="ims" country={country} label="Import IMS" />
          <ExportSheetButton sheet="ims" country={country} label="Export IMS" />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-[75vh]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-20">
                {/* Year headers */}
                <tr className="bg-muted">
                  <th className="sticky left-0 z-20 bg-muted px-2 py-2 text-left font-medium text-muted-foreground min-w-[50px]">Weight</th>
                  <th className="sticky left-[50px] z-20 bg-muted px-2 py-2 text-left font-medium text-muted-foreground min-w-[180px]">SKU Name</th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`year-${year}`}>
                        {!isCollapsed && yPeriods.map((p) => (
                          <th key={p.id} className="px-1 py-1 text-center font-bold border-l border-border text-primary min-w-[70px]">
                            {p.label}
                          </th>
                        ))}
                        <th
                          className="px-2 py-1 text-center font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-800 min-w-[70px] cursor-pointer select-none hover:bg-amber-100 transition-colors"
                          onClick={() => toggleYear(year)}
                          title={isCollapsed ? `Expand ${year}` : `Collapse ${year}`}
                        >
                          <span className="inline-flex items-center gap-1 justify-center">
                            {isCollapsed ? "▶" : "▼"} FY {year}
                          </span>
                        </th>
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedSkus.map(({ category, skus: catSkus }) => {
                  const isCatCollapsed = collapsedCategories.has(category);
                  return (
                    <Fragment key={category}>
                      {/* Category header */}
                      <tr
                        className="bg-muted/30 border-y border-border cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => toggleCategory(category)}
                      >
                        <td colSpan={totalColCount} className="px-3 py-1.5 font-semibold text-[11px] uppercase tracking-wide text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            {isCatCollapsed ? "▶" : "▼"} {category}
                          </span>
                        </td>
                      </tr>

                      {!isCatCollapsed && catSkus.map((sku) => (
                        <tr key={sku.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="sticky left-0 z-10 bg-background px-2 py-1.5">
                            <div className="flex flex-col items-start gap-0.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                sku.weight === '50g' ? 'bg-blue-100 text-blue-700' :
                                sku.weight === '250g' ? 'bg-amber-100 text-amber-700' :
                                'bg-rose-100 text-rose-700'
                              }`}>{sku.weight}</span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                ((sku as any).packagingType ?? 'New') === 'New' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-700'
                              }`}>{(sku as any).packagingType ?? 'New'}</span>
                            </div>
                          </td>
                          <td className="sticky left-[50px] z-10 bg-background px-2 py-1.5 font-medium max-w-[180px] truncate" title={sku.name}>{sku.name}</td>
                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            const isCollapsed = collapsedYears.has(year);
                            const yearTotal = getYearTotal(sku.id, yPeriods);
                            return (
                              <Fragment key={`sku-${sku.id}-year-${year}`}>
                                {!isCollapsed && yPeriods.map((p) => {
                                  const val = getVal(sku.id, p.id);
                                  const cellKey = `${sku.id}-${p.id}`;
                                  const isEditing = editingCell === cellKey;
                                  return (
                                    <td
                                      key={p.id}
                                      className="px-1 py-1 text-right border-l border-border/30 min-w-[70px] cursor-pointer hover:bg-primary/10"
                                      onClick={() => !isEditing && handleCellClick(cellKey, val)}
                                    >
                                      {isEditing ? (
                                        <input
                                          ref={inputRef}
                                          type="number"
                                          className="w-full text-right bg-primary/10 border border-primary rounded px-1 py-0.5 text-xs focus:outline-none"
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } handleCellSave(sku.id, p.id); }}
                                          onKeyDown={(e) => handleKeyDown(e, sku.id, p.id)}
                                        />
                                      ) : (
                                        <span className={val === 0 ? "text-muted-foreground/40" : ""}>
                                          {formatNumber(val)}
                                        </span>
                                      )}
                                    </td>
                                  );
                                })}
                                {/* Year total */}
                                <td className="px-2 py-1 text-right border-l-2 border-amber-400 bg-amber-50 font-bold text-amber-900 min-w-[70px]">
                                  {formatNumber(yearTotal)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))}

                      {/* Category subtotal */}
                      {!isCatCollapsed && (
                        <tr className="bg-muted/20 border-y border-border font-semibold">
                          <td className="sticky left-0 z-10 bg-muted/20 px-2 py-1.5 text-muted-foreground text-[10px]"></td>
                          <td className="sticky left-[50px] z-10 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground uppercase tracking-wide">
                            {category} Total
                          </td>
                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            const isCollapsed = collapsedYears.has(year);
                            return (
                              <Fragment key={`cat-total-${category}-${year}`}>
                                {!isCollapsed && yPeriods.map((p) => (
                                  <td key={p.id} className="px-1 py-1 text-right border-l border-border/30 text-muted-foreground">
                                    {formatNumber(getCatMonthTotal(category, p.id))}
                                  </td>
                                ))}
                                <td className="px-2 py-1 text-right border-l-2 border-amber-400 bg-amber-50 font-bold text-amber-900">
                                  {formatNumber(getCatYearTotal(category, yPeriods))}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      )}
                    </Fragment>
                  );
                })}

                {/* Grand total */}
                <tr className="bg-primary/10 border-t-2 border-primary font-bold">
                  <td className="sticky left-0 z-10 bg-primary/10 px-2 py-2 text-primary text-[11px]"></td>
                  <td className="sticky left-[50px] z-10 bg-primary/10 px-2 py-2 text-primary text-[11px] uppercase tracking-wide">
                    Grand Total
                  </td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`grand-total-${year}`}>
                        {!isCollapsed && yPeriods.map((p) => (
                          <td key={p.id} className="px-1 py-2 text-right border-l border-border/30 text-primary">
                            {formatNumber(getGrandMonthTotal(p.id))}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right border-l-2 border-amber-400 bg-amber-100 font-bold text-amber-900">
                          {formatNumber(getGrandYearTotal(yPeriods))}
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
