import { Fragment } from "react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useMemo, useState, useCallback, useRef } from "react";
import { useGridNav } from "@/hooks/useGridNav";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { computeArrivalDate, formatArrivalDate } from "./ShipmentPage";
import ExportSheetButton from "@/components/ExportSheetButton";

type ArrivalStatus = "Pending" | "In Transit" | "Arrived" | "Delayed" | "Cleared" | "Partially Cleared";

const STATUS_CONFIG: Record<ArrivalStatus, { label: string; className: string }> = {
  "Pending":           { label: "Pending",            className: "bg-gray-100 text-gray-600" },
  "In Transit":        { label: "In Transit",         className: "bg-blue-100 text-blue-700" },
  "Arrived":           { label: "Arrived (at port)",  className: "bg-amber-100 text-amber-700" },
  "Delayed":           { label: "Delayed",            className: "bg-red-100 text-red-700" },
  "Partially Cleared": { label: "Partially Cleared",  className: "bg-teal-100 text-teal-700 font-semibold" },
  "Cleared":           { label: "Cleared",            className: "bg-emerald-100 text-emerald-700 font-semibold" },
};

const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

/**
 * Lebanon formula rules (unchanged):
 * For months from 2026-02 onward:
 *   W1 = Shipment (M-1) W3, W2 = Shipment (M-1) W4
 *   W3 = Shipment (M) W1,  W4 = Shipment (M) W2
 * For 2026-01: W3 = Ship(2026-01)W1, W4 = Ship(2026-01)W2
 * For 2025-12: W4 = Ship(2025-12)W2
 * Before 2025-12: all raw/editable
 */
type Period = { id: number; year: number; month: number; label: string; sortOrder: number };

interface FormulaResult { isFormula: boolean; value: number; }

function getFormulaStatus(
  year: number, month: number, weekKey: string,
  periodMap: Map<string, Period>,
  shipmentMap: Map<string, { week1: string; week2: string; week3: string; week4: string }>,
  skuId: number,
): FormulaResult {
  const getShip = (y: number, m: number, wk: 'week1' | 'week2' | 'week3' | 'week4'): number => {
    const p = periodMap.get(`${y}-${m}`);
    if (!p) return 0;
    const d = shipmentMap.get(`${skuId}-${p.id}`);
    if (!d) return 0;
    return parseFloat(d[wk]) || 0;
  };
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  if (year < 2025 || (year === 2025 && month < 12)) return { isFormula: false, value: 0 };
  if (year === 2025 && month === 12) {
    if (weekKey === "week4") return { isFormula: true, value: getShip(2025, 12, 'week2') };
    return { isFormula: false, value: 0 };
  }
  if (year === 2026 && month === 1) {
    if (weekKey === "week3") return { isFormula: true, value: getShip(2026, 1, 'week1') };
    if (weekKey === "week4") return { isFormula: true, value: getShip(2026, 1, 'week2') };
    return { isFormula: false, value: 0 };
  }
  if (year > 2026 || (year === 2026 && month >= 2)) {
    switch (weekKey) {
      case "week1": return { isFormula: true, value: getShip(prevYear, prevMonth, 'week3') };
      case "week2": return { isFormula: true, value: getShip(prevYear, prevMonth, 'week4') };
      case "week3": return { isFormula: true, value: getShip(year, month, 'week1') };
      case "week4": return { isFormula: true, value: getShip(year, month, 'week2') };
    }
  }
  return { isFormula: false, value: 0 };
}

export default function ArrivalPage() {
  const { user: appUser } = useAppAuth();
  const { country, config } = useCountry();
  const isLebanon = country === "Lebanon";
  const utils = trpc.useUtils();

  const { data: lbData, isLoading: lbLoading, isFetching: lbFetching, refetch: lbRefetch } = trpc.data.arrival.useQuery(undefined, { enabled: isLebanon, staleTime: 0, refetchOnWindowFocus: true });
  const { data: intlData, isLoading: intlLoading, isFetching: intlFetching, refetch: intlRefetch } = trpc.country.data.useQuery(
    { country: country as "Syria" | "Libya" },
    { enabled: !isLebanon && (country === "Syria" || country === "Libya"), staleTime: 0, refetchOnWindowFocus: true }
  );
  const data = isLebanon
    ? lbData
    : intlData
      ? { skus: intlData.skus, periods: intlData.periods, data: intlData.arrival, shipment: intlData.shipment }
      : undefined;
  const isLoading = isLebanon ? lbLoading : intlLoading;
  const isSyncing = isLebanon ? lbFetching : intlFetching;
  const refetchAll = isLebanon ? lbRefetch : intlRefetch;

  const updateCellLb = trpc.update.arrivalCell.useMutation({
    onSuccess: () => {
      utils.data.arrival.invalidate();
      utils.data.planningFg.invalidate();
      utils.data.imsVsForecast.invalidate();
    },
    onError: (err) => toast.error("Failed to save: " + err.message),
  });
  const updateCellIntl = trpc.country.updateArrival.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to save: " + err.message),
  });
  const updateCell = {
    mutate: (params: any) => {
      if (isLebanon) updateCellLb.mutate(params);
      else updateCellIntl.mutate({ ...params, country: country! });
    },
    isPending: isLebanon ? updateCellLb.isPending : updateCellIntl.isPending,
  };

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [oldValue, setOldValue] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());

  // ── Filter state (Syria/Libya arrival view) ──────────────────────────────
  const [filterSku, setFilterSku] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterYear, setFilterYear] = useState<string>("all");
  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [collapsedPeriods, setCollapsedPeriods] = useState<Set<string>>(new Set());
  const togglePeriodCollapse = useCallback((key: string) => {
    setCollapsedPeriods(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);

  const toggleYear = useCallback((year: number) => {
    setCollapsedYears(prev => { const next = new Set(prev); if (next.has(year)) next.delete(year); else next.add(year); return next; });
  }, []);
  const toggleCategory = useCallback((category: string) => {
    setCollapsedCategories(prev => { const next = new Set(prev); if (next.has(category)) next.delete(category); else next.add(category); return next; });
  }, []);

  const rawDataMap = useMemo(() => {
    const map = new Map<string, { week1: string; week2: string; week3: string; week4: string }>();
    if (data?.data) {
      for (const d of data.data) {
        map.set(`${d.skuId}-${d.periodId}`, { week1: d.week1 ?? "0", week2: d.week2 ?? "0", week3: d.week3 ?? "0", week4: d.week4 ?? "0" });
      }
    }
    return map;
  }, [data]);

  const updateArrivalStatus = trpc.country.updateArrivalStatus.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to update status: " + err.message),
  });

  const updateClearedQty = trpc.country.updateClearedQty.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to save cleared qty: " + err.message),
  });

  const updateClearedDate = trpc.country.updateClearedDate.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to save cleared date: " + err.message),
  });

  // Clearance events query (Syria/Libya only)
  const { data: clearanceEventsData } = trpc.country.clearanceEvents.useQuery(
    { country: country as "Syria" | "Libya" },
    { enabled: !isLebanon && (country === "Syria" || country === "Libya") }
  );

  // Map: batchKey -> clearance events
  const clearanceEventsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: number; clearedQty: string; clearedDate: string | Date; pendingClearDate: string | Date | null; notes: string | null; invoiceRef: string | null; containerRef: string | null }>>();
    if (clearanceEventsData) {
      for (const ev of clearanceEventsData) {
        const key = `${ev.skuId}-${ev.periodId}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev as any);
      }
    }
    return map;
  }, [clearanceEventsData]);

  // State for expanded batch panels
  const [expandedBatches, setExpandedBatches] = useState<Set<string>>(new Set());
  const toggleBatchExpand = useCallback((key: string) => {
    setExpandedBatches(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);

  // State for add-clearance inline form per batch
  const [addingClearance, setAddingClearance] = useState<Record<string, { qty: string; clearedDate: string; pendingClearDate: string; invoiceRef: string; containerRef: string }>>({});

  const addClearanceEvent = trpc.country.addClearanceEvent.useMutation({
    onSuccess: () => { utils.country.data.invalidate(); utils.country.clearanceEvents.invalidate(); utils.country.planningFg.invalidate(); },
    onError: (err) => toast.error("Failed to add clearance: " + err.message),
  });

  const deleteClearanceEvent = trpc.country.deleteClearanceEvent.useMutation({
    onSuccess: () => { utils.country.data.invalidate(); utils.country.clearanceEvents.invalidate(); utils.country.planningFg.invalidate(); },
    onError: (err) => toast.error("Failed to delete clearance: " + err.message),
  });

  const updateClearanceEvent = trpc.country.updateClearanceEvent.useMutation({
    onSuccess: () => { utils.country.data.invalidate(); utils.country.clearanceEvents.invalidate(); utils.country.planningFg.invalidate(); },
    onError: (err) => toast.error("Failed to update clearance: " + err.message),
  });

  // Keep old single-event state for backward compat (Lebanon)
  const [editingClearedQty, setEditingClearedQty] = useState<string | null>(null);
  const [clearedQtyValue, setClearedQtyValue] = useState("");
  const [clearedDateLocal, setClearedDateLocal] = useState<Record<string, string>>({});
  const [pendingDateLocal, setPendingDateLocal] = useState<Record<string, string>>({});
  const updateBatchNote = trpc.country.updateProduction.useMutation({
    onSuccess: () => { intlRefetch(); },
    onError: (err) => toast.error("Failed to save note: " + err.message),
  });

  const updatePendingClearDate = trpc.country.updatePendingClearDate.useMutation({
    onSuccess: () => utils.country.data.invalidate(),
    onError: (err) => toast.error("Failed to save pending clear date: " + err.message),
  });

  // For Syria/Libya: shipment map includes arrivalOffset fields + arrivalStatus + clearedQty + clearedDate + pendingClearDate
  const shipmentMap = useMemo(() => {
    const map = new Map<string, { week1: string; week2: string; week3: string; week4: string; arrivalOffsetValue?: number; arrivalOffsetUnit?: string; arrivalStatus?: string; clearedQty?: string | null; clearedDate?: string | null; pendingClearDate?: string | null; note?: string | null }>();
    if (data?.shipment) {
      for (const d of data.shipment) {
        map.set(`${d.skuId}-${d.periodId}`, {
          week1: d.week1 ?? "0", week2: d.week2 ?? "0", week3: d.week3 ?? "0", week4: d.week4 ?? "0",
          arrivalOffsetValue: (d as any).arrivalOffsetValue ?? 0,
          arrivalOffsetUnit: (d as any).arrivalOffsetUnit ?? "days",
          arrivalStatus: (d as any).arrivalStatus ?? "Pending",
          clearedQty: (d as any).clearedQty ?? null,
          clearedDate: (d as any).clearedDate ?? null,
          pendingClearDate: (d as any).pendingClearDate ?? null,
          note: (d as any).note ?? null,
        });
      }
    }
    return map;
  }, [data]);

  const periodMap = useMemo(() => {
    const map = new Map<string, Period>();
    if (data?.periods) { for (const p of data.periods) map.set(`${p.year}-${p.month}`, p); }
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
    const groups: { category: string; skus: typeof sortedSkus }[] = [];
    let currentCat = "";
    for (const sku of sortedSkus) {
      if (sku.category !== currentCat) { currentCat = sku.category; groups.push({ category: currentCat, skus: [] }); }
      groups[groups.length - 1].skus.push(sku);
    }
    return groups;
  }, [sortedSkus]);

  const formatNumber = (val: number) => val === 0 ? "-" : val.toLocaleString('en-US', { maximumFractionDigits: 0 });

  const handleCellClick = useCallback((cellKey: string, currentValue: string) => {
    setEditingCell(cellKey); setOldValue(currentValue); setEditValue(currentValue === "0" ? "" : currentValue);
  }, []);

  const handleCellSave = useCallback((skuId: number, periodId: number, weekKey: string) => {
    const numVal = parseFloat(editValue) || 0;
    const sku = data?.skus.find(s => s.id === skuId);
    const period = data?.periods.find(p => p.id === periodId);
    const oldKey = `old${weekKey.charAt(0).toUpperCase()}${weekKey.slice(1)}` as "oldWeek1" | "oldWeek2" | "oldWeek3" | "oldWeek4";
    updateCell.mutate({ skuId, periodId, [weekKey]: numVal.toString(), username: appUser?.displayName, skuName: sku?.name, periodLabel: period?.label, [oldKey]: oldValue });
    setEditingCell(null);
  }, [editValue, updateCell, oldValue, appUser, data]);

  const years = Array.from(new Set(periods.map(p => p.year))).sort();
  const periodsByYear = years.map(year => ({
    year,
    periods: periods.filter(p => p.year === year).sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  // Navigable cell IDs for Lebanon arrival (week cells only, non-formula)
  const WEEKS_ARR = ["week1", "week2", "week3", "week4"] as const;
  const navigableCellIds = useMemo(() => {
    if (!isLebanon) return []; // Syria/Libya arrival uses a different layout
    const ids: string[] = [];
    for (const group of groupedSkus) {
      if (collapsedCategories.has(group.category)) continue;
      for (const sku of group.skus) {
        for (const { year, periods: yPeriods } of periodsByYear) {
          if (collapsedYears.has(year)) continue;
          for (const p of yPeriods) {
            for (const wk of WEEKS_ARR) {
              // Only include non-formula cells
              const formula = getFormulaStatus(p.year, p.month, wk, periodMap, shipmentMap as any, sku.id);
              if (!formula.isFormula) ids.push(`${sku.id}-${p.id}-${wk}`);
            }
          }
        }
      }
    }
    return ids;
  }, [isLebanon, groupedSkus, periodsByYear, collapsedYears, collapsedCategories, periodMap, shipmentMap]);

  const visibleWeekColCount = useMemo(() => {
    if (!isLebanon) return 4;
    let total = 0;
    for (const { year, periods: yPeriods } of periodsByYear) {
      if (collapsedYears.has(year)) continue;
      total += yPeriods.length * WEEKS_ARR.length;
    }
    return total;
  }, [isLebanon, periodsByYear, collapsedYears]);

  const { handleNavKeyDown } = useGridNav({
    cellIds: navigableCellIds,
    editingCell,
    setEditingCell: (id) => {
      if (id === null) { setEditingCell(null); return; }
      const parts = id.split("-");
      const skuId = parseInt(parts[0]);
      const periodId = parseInt(parts[1]);
      const wk = parts[2];
      const d = rawDataMap.get(`${skuId}-${periodId}`);
      const rawVal = d?.[wk as "week1"] ?? "0";
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

  // Lebanon helpers
  const getCellInfo = useCallback((skuId: number, period: Period, weekKey: string): { value: number; isFormula: boolean } => {
    const formula = getFormulaStatus(period.year, period.month, weekKey, periodMap, shipmentMap as any, skuId);
    if (formula.isFormula) return { value: formula.value, isFormula: true };
    const d = rawDataMap.get(`${skuId}-${period.id}`);
    if (!d) return { value: 0, isFormula: false };
    return { value: parseFloat(d[weekKey as keyof typeof d]) || 0, isFormula: false };
  }, [periodMap, shipmentMap, rawDataMap]);

  const getMonthTotal = useCallback((skuId: number, period: Period) => {
    let total = 0;
    for (const wk of ["week1","week2","week3","week4"]) total += getCellInfo(skuId, period, wk).value;
    return total;
  }, [getCellInfo]);

  const getFullYearTotal = useCallback((skuId: number, yearPeriods: Period[]) => {
    let total = 0;
    for (const p of yearPeriods) total += getMonthTotal(skuId, p);
    return total;
  }, [getMonthTotal]);

  const computeCatWeekTotal = useCallback((category: string, period: Period, weekKey: string) => {
    let total = 0;
    for (const sku of allSkus) { if (sku.category !== category) continue; total += getCellInfo(sku.id, period, weekKey).value; }
    return total;
  }, [allSkus, getCellInfo]);

  const computeCatMonthTotal = useCallback((category: string, period: Period) => {
    let total = 0;
    for (const sku of allSkus) { if (sku.category !== category) continue; total += getMonthTotal(sku.id, period); }
    return total;
  }, [allSkus, getMonthTotal]);

  const computeCatFullYearTotal = useCallback((category: string, yearPeriods: Period[]) => {
    let total = 0;
    for (const sku of allSkus) { if (sku.category !== category) continue; total += getFullYearTotal(sku.id, yearPeriods); }
    return total;
  }, [allSkus, getFullYearTotal]);

  const computeGrandWeekTotal = useCallback((period: Period, weekKey: string) => {
    let total = 0;
    for (const sku of allSkus) total += getCellInfo(sku.id, period, weekKey).value;
    return total;
  }, [allSkus, getCellInfo]);

  const computeGrandMonthTotal = useCallback((period: Period) => {
    let total = 0;
    for (const sku of allSkus) total += getMonthTotal(sku.id, period);
    return total;
  }, [allSkus, getMonthTotal]);

  const computeGrandFullYearTotal = useCallback((yearPeriods: Period[]) => {
    let total = 0;
    for (const sku of allSkus) total += getFullYearTotal(sku.id, yearPeriods);
    return total;
  }, [allSkus, getFullYearTotal]);

  const totalColCount = useMemo(() => {
    return 2 + periodsByYear.reduce((acc, { year, periods: yPeriods }) => {
      return acc + (collapsedYears.has(year) ? 1 : yPeriods.length * 5 + 1);
    }, 0);
  }, [periodsByYear, collapsedYears]);

  if (isLoading) return <TableSkeleton title="Arrival" rows={10} cols={12} />;

  // ============================================================
  // SYRIA / LIBYA: Arrival driven by production offset
  // ============================================================
  if (!isLebanon) {
    // Build list of production batches with arrival dates
      type Batch = {
        sku: typeof allSkus[0];
        period: Period;
        total: number;
        arrivalOffsetValue: number;
        arrivalOffsetUnit: string;
        arrivalDate: Date | null;
        arrivalStatus: ArrivalStatus;
        clearedQty: number | null;
        clearedDate: string | null;
        pendingClearDate: string | null;
        note: string | null;
      };

    const batches: Batch[] = [];
    for (const sku of sortedSkus) {
      for (const period of periods) {
        const shipRow = shipmentMap.get(`${sku.id}-${period.id}`);
        if (!shipRow) continue;
        const total = (parseFloat(shipRow.week1) || 0) + (parseFloat(shipRow.week2) || 0) + (parseFloat(shipRow.week3) || 0) + (parseFloat(shipRow.week4) || 0);
        if (total === 0 && (shipRow.arrivalOffsetValue ?? 0) === 0) continue;
        const offVal = shipRow.arrivalOffsetValue ?? 0;
        const offUnit = shipRow.arrivalOffsetUnit ?? "days";
        const arrivalDate = offVal > 0 ? computeArrivalDate(period.year, period.month, offVal, offUnit) : null;
        const arrivalStatus = (shipRow.arrivalStatus as ArrivalStatus) ?? "Pending";
        const clearedQty = shipRow.clearedQty != null ? parseFloat(shipRow.clearedQty) : null;
        const clearedDate = shipRow.clearedDate ?? null;
        const pendingClearDate = shipRow.pendingClearDate ?? null;
        batches.push({ sku, period, total, arrivalOffsetValue: offVal, arrivalOffsetUnit: offUnit, arrivalDate, arrivalStatus, clearedQty, clearedDate, pendingClearDate, note: shipRow.note ?? null });
      }
    }

    // Sort by arrival date (nulls last), then by SKU name
    batches.sort((a, b) => {
      if (!a.arrivalDate && !b.arrivalDate) return 0;
      if (!a.arrivalDate) return 1;
      if (!b.arrivalDate) return -1;
      return a.arrivalDate.getTime() - b.arrivalDate.getTime();
    });

    // ── Dashboard card stats (computed from ALL batches, unfiltered) ────────
    const clearedBatches = batches.filter(b => b.arrivalStatus === "Cleared");
    const partialBatches = batches.filter(b => b.arrivalStatus === "Partially Cleared");
    const arrivedBatches = batches.filter(b => b.arrivalStatus === "Arrived");
    const inTransitBatches = batches.filter(b => b.arrivalStatus === "In Transit");
    const pendingBatches = batches.filter(b => b.arrivalStatus === "Pending");
    const delayedBatches = batches.filter(b => {
      const today = new Date();
      const isAtPort = b.arrivalDate && b.arrivalDate <= today && b.arrivalStatus !== "Pending" && b.arrivalStatus !== "In Transit";
      const daysAtPort = isAtPort && b.arrivalDate ? Math.floor((today.getTime() - b.arrivalDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
      return daysAtPort !== null && daysAtPort > 7 && b.arrivalStatus !== "Cleared";
    });

    const sumQty = (list: typeof batches) => list.reduce((s, b) => s + b.total, 0);
    const sumCleared = (list: typeof batches) => list.reduce((s, b) => s + (b.clearedQty ?? 0), 0);
    const totalBatches = batches.length;

    // Still to Clear: for each non-fully-cleared batch, qty not yet cleared
    const stillToClearQty = batches
      .filter(b => b.arrivalStatus !== "Pending" && b.arrivalStatus !== "In Transit")
      .reduce((s, b) => {
        if (b.arrivalStatus === "Cleared") return s; // fully cleared
        const pending = b.clearedQty !== null ? Math.max(0, b.total - b.clearedQty) : b.total;
        return s + pending;
      }, 0);
    const stillToClearBatches = batches.filter(b =>
      b.arrivalStatus !== "Pending" && b.arrivalStatus !== "In Transit" && b.arrivalStatus !== "Cleared"
    ).length;

    // ── Available years/months for period filter ──────────────────────────
    const availableYears = Array.from(new Set(batches.map(b => b.period.year))).sort();
    const availableMonths = filterYear === "all"
      ? Array.from(new Set(batches.map(b => b.period.month))).sort((a, b) => a - b)
      : Array.from(new Set(batches.filter(b => b.period.year === parseInt(filterYear)).map(b => b.period.month))).sort((a, b) => a - b);
    const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

    // ── Apply filters to batches ──────────────────────────────────────────
    const filteredBatches = batches.filter(b => {
      if (filterSku && !b.sku.name.toLowerCase().includes(filterSku.toLowerCase())) return false;
      if (filterStatus !== "all" && b.arrivalStatus !== filterStatus) return false;
      if (filterYear !== "all" && b.period.year !== parseInt(filterYear)) return false;
      if (filterMonth !== "all" && b.period.month !== parseInt(filterMonth)) return false;
      return true;
    });
    const isFiltered = filterSku !== "" || filterStatus !== "all" || filterYear !== "all" || filterMonth !== "all";

    // ── Group filtered batches by period ─────────────────────────────────
    const periodGroups: { periodKey: string; periodLabel: string; periodYear: number; periodMonth: number; batches: typeof filteredBatches }[] = [];
    const periodGroupMap = new Map<string, typeof filteredBatches>();
    for (const b of filteredBatches) {
      const key = `${b.period.year}-${String(b.period.month).padStart(2,'0')}`;
      if (!periodGroupMap.has(key)) periodGroupMap.set(key, []);
      periodGroupMap.get(key)!.push(b);
    }
    // Sort period groups chronologically
    const sortedPeriodKeys = Array.from(periodGroupMap.keys()).sort();
    for (const key of sortedPeriodKeys) {
      const batchesInPeriod = periodGroupMap.get(key)!;
      const firstBatch = batchesInPeriod[0];
      periodGroups.push({
        periodKey: key,
        periodLabel: firstBatch.period.label,
        periodYear: firstBatch.period.year,
        periodMonth: firstBatch.period.month,
        batches: batchesInPeriod,
      });
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{config?.terms.arrival ?? "Arrival"}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Arrival dates computed from Production batches + arrival offset. Enter <strong className="text-teal-700">Cleared Qty</strong> to record partial or full clearance — cleared quantities flow into Planning FG.
              <span className="ml-2 text-amber-600 font-medium">Status auto-updates: partial qty → Partially Cleared · full qty → Cleared</span>
            </p>
          </div>
          <ExportSheetButton sheet="arrival" country={country} label="Export Arrival" />
          <button
            onClick={() => refetchAll()}
            disabled={isSyncing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded border border-primary/40 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            title="Sync all data from server"
          >
            <svg className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isSyncing ? 'Syncing...' : 'Sync All'}
          </button>
        </div>

        {/* ── Filter bar ── */}
        <div className="flex flex-wrap items-center gap-2 bg-muted/40 border border-border rounded-lg px-3 py-2">
          {/* SKU search */}
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="11" cy="11" r="8"/><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35"/></svg>
            <input
              type="text"
              placeholder="Search SKU..."
              value={filterSku}
              onChange={e => setFilterSku(e.target.value)}
              className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary w-36"
            />
          </div>
          {/* Status filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">Status:</span>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All</option>
              {(Object.keys(STATUS_CONFIG) as ArrivalStatus[]).map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
          </div>
          {/* Year filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">Year:</span>
            <select
              value={filterYear}
              onChange={e => { setFilterYear(e.target.value); setFilterMonth("all"); }}
              className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Years</option>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {/* Month filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-medium text-muted-foreground">Month:</span>
            <select
              value={filterMonth}
              onChange={e => setFilterMonth(e.target.value)}
              className="text-xs border border-border rounded px-2 py-1 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Months</option>
              {availableMonths.map(m => <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>)}
            </select>
          </div>
          {/* Clear filters */}
          {isFiltered && (
            <button
              onClick={() => { setFilterSku(""); setFilterStatus("all"); setFilterYear("all"); setFilterMonth("all"); }}
              className="text-[10px] font-medium text-muted-foreground hover:text-foreground px-2 py-1 rounded border border-border hover:bg-muted transition-colors"
            >Clear Filters</button>
          )}
          {/* Result count */}
          <span className="text-[10px] text-muted-foreground ml-auto">
            {isFiltered ? `${filteredBatches.length} of ${totalBatches} batches` : `${totalBatches} batches`}
          </span>
        </div>

        {/* ── Dashboard summary (always visible, above table) ── */}
        {totalBatches > 0 && (() => {
          // Reusable stat card component inline
          const StatCard = ({
            label, sublabel, count, qty, qtyLabel = "units", accent, highlight = false, note,
          }: {
            label: string; sublabel?: string; count: number; qty: number;
            qtyLabel?: string; accent: string; highlight?: boolean; note?: string;
          }) => (
            <div className={`rounded-lg border p-3 flex flex-col gap-1 min-w-0 ${accent}`}>
              {/* Top row: label + batch pill */}
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-foreground leading-tight">{label}</span>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  highlight ? "bg-white/60 text-foreground" : "bg-black/5 text-muted-foreground"
                }`}>{count}</span>
              </div>
              {/* Big quantity number */}
              <div className="text-2xl font-bold leading-none tracking-tight text-foreground">
                {qty.toLocaleString()}
              </div>
              {/* Sub-labels */}
              <div className="text-[10px] text-foreground/60 leading-tight">{qtyLabel}</div>
              {sublabel && <div className="text-[9px] text-foreground/50 leading-tight">{sublabel}</div>}
              {note && <div className="text-[9px] font-medium text-foreground/70 leading-tight mt-0.5">{note}</div>}
            </div>
          );

          return (
            <div className="space-y-2">
              {/* Row 1 — Clearance status (what has been processed) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard
                  label="Cleared"
                  sublabel="fully cleared batches"
                  count={clearedBatches.length}
                  qty={sumCleared(clearedBatches)}
                  qtyLabel="units cleared"
                  accent="bg-emerald-50 border-emerald-200"
                  note="✓ counts in Planning FG"
                />
                <StatCard
                  label="Partially Cleared"
                  sublabel="partial clearance batches"
                  count={partialBatches.length}
                  qty={sumCleared(partialBatches)}
                  qtyLabel="units cleared so far"
                  accent="bg-teal-50 border-teal-200"
                  note="✓ counts in Planning FG"
                />
                <StatCard
                  label="Still to Clear"
                  sublabel="at port, not yet cleared"
                  count={stillToClearBatches}
                  qty={stillToClearQty}
                  qtyLabel="units pending clearance"
                  accent={stillToClearQty > 0 ? "bg-violet-50 border-violet-300" : "bg-muted/30 border-border"}
                  highlight={stillToClearQty > 0}
                />
                <StatCard
                  label="Delayed at Port"
                  sublabel=">7 days without clearance"
                  count={delayedBatches.length}
                  qty={delayedBatches.reduce((s, b) => s + b.total, 0)}
                  qtyLabel="units affected"
                  accent={delayedBatches.length > 0 ? "bg-red-50 border-red-300" : "bg-muted/30 border-border"}
                  highlight={delayedBatches.length > 0}
                />
              </div>
              {/* Row 2 — Pipeline status (what is coming) */}
              <div className="grid grid-cols-3 gap-2">
                <StatCard
                  label="Arrived at Port"
                  sublabel="awaiting clearance process"
                  count={arrivedBatches.length}
                  qty={sumQty(arrivedBatches)}
                  qtyLabel="units at port"
                  accent="bg-amber-50 border-amber-200"
                />
                <StatCard
                  label="In Transit"
                  sublabel="en route to port"
                  count={inTransitBatches.length}
                  qty={sumQty(inTransitBatches)}
                  qtyLabel="units in transit"
                  accent="bg-blue-50 border-blue-200"
                />
                <StatCard
                  label="Pending"
                  sublabel="not yet dispatched"
                  count={pendingBatches.length}
                  qty={sumQty(pendingBatches)}
                  qtyLabel="units planned"
                  accent="bg-muted/30 border-border"
                />
              </div>
            </div>
          );
        })()}

        {batches.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="text-base font-medium mb-2">No production batches found</p>
              <p className="text-sm">Enter production quantities on the <strong>Production</strong> page and set arrival offsets to see computed arrival dates here.</p>
            </CardContent>
          </Card>
        ) : filteredBatches.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <p className="text-base font-medium mb-2">No batches match the current filters</p>
              <p className="text-sm">Try adjusting or clearing the filters above.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {/* Collapse All / Expand All controls */}
            <div className="flex items-center gap-2">
              <button onClick={() => setCollapsedPeriods(new Set(periodGroups.map(g => g.periodKey)))} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors">Collapse All</button>
              <button onClick={() => setCollapsedPeriods(new Set())} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors">Expand All</button>
            </div>
            {periodGroups.map(({ periodKey, periodLabel, batches: periodBatches }) => {
              const isCollapsed = collapsedPeriods.has(periodKey);
              const periodTotal = periodBatches.reduce((s, b) => s + b.total, 0);
              const periodCleared = periodBatches.reduce((s, b) => {
                const evs = clearanceEventsMap.get(`${b.sku.id}-${b.period.id}`) ?? [];
                return s + evs.reduce((es, e) => es + parseFloat(e.clearedQty ?? "0"), 0);
              }, 0);
              const periodStatusCounts: Record<string, number> = {};
              for (const b of periodBatches) periodStatusCounts[b.arrivalStatus] = (periodStatusCounts[b.arrivalStatus] ?? 0) + 1;
              return (
                <div key={periodKey} className="border border-border rounded-lg overflow-hidden">
                  {/* Period header */}
                  <div
                    className="flex items-center gap-3 px-4 py-2.5 bg-muted/60 cursor-pointer hover:bg-muted/80 transition-colors select-none"
                    onClick={() => togglePeriodCollapse(periodKey)}
                  >
                    <span className={`text-muted-foreground transition-transform duration-150 text-[10px] ${isCollapsed ? '' : 'rotate-90'}`}>&#9654;</span>
                    <span className="font-bold text-sm text-foreground">{periodLabel}</span>
                    <span className="text-[11px] text-muted-foreground">{periodBatches.length} SKU{periodBatches.length !== 1 ? 's' : ''}</span>
                    <span className="text-[11px] text-muted-foreground">Total: <strong className="text-foreground">{periodTotal.toLocaleString()}</strong></span>
                    {periodCleared > 0 && <span className="text-[11px] text-teal-700">Cleared: <strong>{periodCleared.toLocaleString()}</strong></span>}
                    <div className="flex gap-1 ml-auto flex-wrap">
                      {Object.entries(periodStatusCounts).map(([status, count]) => (
                        <span key={status} className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_CONFIG[status as ArrivalStatus]?.className ?? 'bg-gray-100 text-gray-600'}`}>
                          {count} {STATUS_CONFIG[status as ArrivalStatus]?.label ?? status}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Period batch list */}
                  {!isCollapsed && (
                    <div className="divide-y divide-border/50">
            {periodBatches.map((batch, idx) => {
              const batchKey = `${batch.sku.id}-${batch.period.id}`;
              const today = new Date();
              const events = clearanceEventsMap.get(batchKey) ?? [];
              const totalCleared = events.reduce((s, e) => s + parseFloat(e.clearedQty ?? "0"), 0);
              const pendingQty = Math.max(0, batch.total - totalCleared);
              const isAtPort = batch.arrivalDate && batch.arrivalDate <= today && batch.arrivalStatus !== "Pending" && batch.arrivalStatus !== "In Transit";
              const daysAtPort = isAtPort && batch.arrivalDate ? Math.floor((today.getTime() - batch.arrivalDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
              const isDelayedAtPort = daysAtPort !== null && daysAtPort > 7 && batch.arrivalStatus !== "Cleared";
              const isExpanded = expandedBatches.has(batchKey);
              const addForm = addingClearance[batchKey];
              const fmtDate = (d: string | Date | null | undefined) => {
                if (!d) return "";
                const s = typeof d === "string" ? d : d.toISOString();
                return s.substring(0, 10);
              };

              return (
                <Card key={batchKey} className={`overflow-hidden border ${
                  batch.arrivalStatus === "Cleared" ? "border-emerald-200" :
                  batch.arrivalStatus === "Partially Cleared" ? "border-teal-200" :
                  isDelayedAtPort ? "border-red-200" : "border-border"
                }`}>
                  {/* ── Batch header row ── */}
                  <div
                    className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors ${
                      idx % 2 === 1 ? "bg-slate-50/50" : ""
                    }`}
                    onClick={() => toggleBatchExpand(batchKey)}
                  >
                    {/* Expand chevron */}
                    <span className={`text-muted-foreground transition-transform duration-150 text-[10px] ${isExpanded ? "rotate-90" : ""}`}>▶</span>

                    {/* SKU info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">{batch.sku.name}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          batch.sku.weight === "50g" ? "bg-blue-100 text-blue-700" :
                          batch.sku.weight === "250g" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"
                        }`}>{batch.sku.weight}</span>
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          ((batch.sku as any).packagingType ?? 'New') === 'New' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-700'
                        }`}>{(batch.sku as any).packagingType ?? 'New'}</span>
                        <span className="text-[10px] text-muted-foreground">{batch.sku.category}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground flex-wrap">
                        <span>Period: <strong className="text-foreground">{batch.period.label}</strong></span>
                        <span>Production: <strong className="text-foreground">{formatNumber(batch.total)}</strong></span>
                        {batch.arrivalDate && <span>Est. Arrival: <strong className="text-amber-700">{formatArrivalDate(batch.arrivalDate)}</strong></span>}
                        {daysAtPort !== null && <span className={`font-semibold ${isDelayedAtPort ? "text-red-600" : "text-slate-600"}`}>{daysAtPort}d at port{isDelayedAtPort ? " ⚠" : ""}</span>}
                      </div>
                    </div>

                    {/* Cleared / Pending summary */}
                    <div className="flex items-center gap-4 text-right shrink-0">
                      <div>
                        <div className="text-[10px] text-muted-foreground">Cleared</div>
                        <div className={`text-sm font-bold ${totalCleared > 0 ? "text-teal-700" : "text-muted-foreground"}`}>
                          {totalCleared > 0 ? formatNumber(totalCleared) : "—"}
                        </div>
                        {events.length > 0 && <div className="text-[9px] text-muted-foreground">{events.length} event{events.length > 1 ? "s" : ""}</div>}
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">Pending</div>
                        <div className={`text-sm font-bold ${pendingQty > 0 && totalCleared > 0 ? "text-amber-700" : "text-muted-foreground"}`}>
                          {totalCleared > 0 ? formatNumber(pendingQty) : "—"}
                        </div>
                      </div>
                      {/* Status */}
                      <div onClick={e => e.stopPropagation()}>
                        <Select
                          value={batch.arrivalStatus}
                          onValueChange={(val) => updateArrivalStatus.mutate({
                            skuId: batch.sku.id, periodId: batch.period.id,
                            status: val as ArrivalStatus, country: country as "Syria" | "Libya",
                            username: appUser?.displayName, skuName: batch.sku.name, periodLabel: batch.period.label,
                          })}
                        >
                          <SelectTrigger className={`h-6 text-[10px] font-medium border-0 px-2 rounded ${STATUS_CONFIG[batch.arrivalStatus]?.className ?? "bg-gray-100 text-gray-600"}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(STATUS_CONFIG) as ArrivalStatus[]).map(s => (
                              <SelectItem key={s} value={s} className="text-xs">
                                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_CONFIG[s].className}`}>{STATUS_CONFIG[s].label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  {/* ── Expanded clearance events panel ── */}
                  {isExpanded && (
                    <div className="border-t border-border bg-slate-50/70 px-4 py-3 space-y-2">
                      {/* Events table */}
                      {events.length > 0 && (
                        <table className="w-full text-xs border-collapse mb-2">
                          <thead>
                            <tr className="bg-muted/60 border-b border-border">
                              <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                              <th className="px-2 py-1.5 text-right font-medium text-teal-700">Cleared Qty</th>
                              <th className="px-2 py-1.5 text-left font-medium text-teal-700">Cleared Date</th>
                              <th className="px-2 py-1.5 text-right font-medium text-amber-700">Pending Qty</th>
                              <th className="px-2 py-1.5 text-left font-medium text-violet-700">Pending Clear Date</th>
                              <th className="px-2 py-1.5 text-left font-medium text-blue-700">Invoice #</th>
                              <th className="px-2 py-1.5 text-left font-medium text-emerald-700">Container #</th>
                              <th className="px-2 py-1.5 text-center font-medium text-muted-foreground">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {events.map((ev, evIdx) => {
                              const clearedUpToHere = events.slice(0, evIdx + 1).reduce((s, e) => s + parseFloat(e.clearedQty ?? "0"), 0);
                              const evPendingQty = Math.max(0, batch.total - clearedUpToHere);
                              return (
                                <tr key={ev.id} className="border-b border-border/40 hover:bg-white/60">
                                  <td className="px-2 py-1.5 text-muted-foreground font-medium">{evIdx + 1}</td>
                                  {/* Cleared Qty - editable */}
                                  <td className="px-2 py-1.5 text-right">
                                    <input
                                      type="number"
                                      className="w-20 text-right text-xs border border-teal-300 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                      defaultValue={ev.clearedQty}
                                      onBlur={e => {
                                        const val = e.target.value;
                                        if (val !== ev.clearedQty) {
                                          updateClearanceEvent.mutate({ eventId: ev.id, skuId: batch.sku.id, periodId: batch.period.id, country: country as "Syria" | "Libya", clearedQty: val, username: appUser?.displayName, skuName: batch.sku.name, periodLabel: batch.period.label });
                                        }
                                      }}
                                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    />
                                  </td>
                                  {/* Cleared Date - editable */}
                                  <td className="px-2 py-1.5">
                                    <input
                                      type="date"
                                      className="text-xs border border-teal-300 rounded px-1 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                      defaultValue={fmtDate(ev.clearedDate)}
                                      onBlur={e => {
                                        const val = e.target.value;
                                        if (val !== fmtDate(ev.clearedDate)) {
                                          updateClearanceEvent.mutate({ eventId: ev.id, skuId: batch.sku.id, periodId: batch.period.id, country: country as "Syria" | "Libya", clearedDate: val, username: appUser?.displayName, skuName: batch.sku.name, periodLabel: batch.period.label });
                                        }
                                      }}
                                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    />
                                  </td>
                                  {/* Pending Qty - auto-computed */}
                                  <td className="px-2 py-1.5 text-right">
                                    <span className={`text-xs font-semibold ${evPendingQty > 0 ? "text-amber-700" : "text-emerald-600"}`}>
                                      {evPendingQty > 0 ? formatNumber(evPendingQty) : "Fully Cleared"}
                                    </span>
                                  </td>
                                  {/* Pending Clear Date - editable only on last event */}
                                  <td className="px-2 py-1.5">
                                    {evIdx === events.length - 1 ? (
                                      <input
                                        type="date"
                                        className="text-xs border border-violet-300 rounded px-1 py-0.5 bg-violet-50/60 focus:outline-none focus:ring-1 focus:ring-violet-500"
                                        defaultValue={fmtDate(ev.pendingClearDate)}
                                        onBlur={e => {
                                          const val = e.target.value || null;
                                          if (val !== fmtDate(ev.pendingClearDate)) {
                                            updateClearanceEvent.mutate({ eventId: ev.id, skuId: batch.sku.id, periodId: batch.period.id, country: country as "Syria" | "Libya", pendingClearDate: val, username: appUser?.displayName, skuName: batch.sku.name, periodLabel: batch.period.label });
                                          }
                                        }}
                                        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                      />
                                    ) : (
                                      <span className="text-[10px] text-muted-foreground italic">Superseded</span>
                                    )}
                                  </td>
                                  {/* Invoice # - editable */}
                                  <td className="px-2 py-1.5">
                                    <input
                                      type="text"
                                      className="text-xs border border-blue-200 rounded px-1 py-0.5 bg-blue-50/40 focus:outline-none focus:ring-1 focus:ring-blue-400 w-full min-w-[100px]"
                                      defaultValue={ev.invoiceRef ?? ""}
                                      placeholder="Invoice #"
                                      onBlur={e => {
                                        const val = e.target.value || null;
                                        if (val !== (ev.invoiceRef ?? null)) {
                                          updateClearanceEvent.mutate({ eventId: ev.id, skuId: batch.sku.id, periodId: batch.period.id, country: country as "Syria" | "Libya", invoiceRef: val, username: appUser?.displayName, skuName: batch.sku.name, periodLabel: batch.period.label });
                                        }
                                      }}
                                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    />
                                  </td>
                                  {/* Container # - editable */}
                                  <td className="px-2 py-1.5">
                                    <input
                                      type="text"
                                      className="text-xs border border-emerald-200 rounded px-1 py-0.5 bg-emerald-50/40 focus:outline-none focus:ring-1 focus:ring-emerald-400 w-full min-w-[100px]"
                                      defaultValue={ev.containerRef ?? ""}
                                      placeholder="Container #"
                                      onBlur={e => {
                                        const val = e.target.value || null;
                                        if (val !== (ev.containerRef ?? null)) {
                                          updateClearanceEvent.mutate({ eventId: ev.id, skuId: batch.sku.id, periodId: batch.period.id, country: country as "Syria" | "Libya", containerRef: val, username: appUser?.displayName, skuName: batch.sku.name, periodLabel: batch.period.label });
                                        }
                                      }}
                                      onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                                    />
                                  </td>
                                  {/* Delete */}
                                  <td className="px-2 py-1.5 text-center">
                                    <button
                                      className="text-red-400 hover:text-red-600 text-[11px] font-medium px-1.5 py-0.5 rounded hover:bg-red-50 transition-colors"
                                      onClick={() => {
                                        if (confirm(`Delete clearance event #${evIdx + 1}?`)) {
                                          deleteClearanceEvent.mutate({ eventId: ev.id, skuId: batch.sku.id, periodId: batch.period.id, country: country as "Syria" | "Libya", username: appUser?.displayName, skuName: batch.sku.name, periodLabel: batch.period.label });
                                        }
                                      }}
                                    >Delete</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}

                      {/* Add clearance form */}
                      {addForm ? (
                        <div className="flex items-end gap-2 flex-wrap bg-white border border-teal-200 rounded-lg px-3 py-2">
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[10px] font-medium text-teal-700">Cleared Qty *</label>
                            <input
                              type="number"
                              className="w-24 text-right text-xs border border-teal-300 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
                              placeholder="e.g. 5000"
                              value={addForm.qty}
                              onChange={e => setAddingClearance(prev => ({ ...prev, [batchKey]: { ...prev[batchKey], qty: e.target.value } }))}
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[10px] font-medium text-teal-700">Cleared Date *</label>
                            <input
                              type="date"
                              className="text-xs border border-teal-300 rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
                              value={addForm.clearedDate}
                              onChange={e => setAddingClearance(prev => ({ ...prev, [batchKey]: { ...prev[batchKey], clearedDate: e.target.value } }))}
                            />
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <label className="text-[10px] font-medium text-violet-700">Pending Clear Date</label>
                            <input
                              type="date"
                              className="text-xs border border-violet-300 rounded px-1 py-1 bg-violet-50/60 focus:outline-none focus:ring-1 focus:ring-violet-500"
                              value={addForm.pendingClearDate}
                              onChange={e => setAddingClearance(prev => ({ ...prev, [batchKey]: { ...prev[batchKey], pendingClearDate: e.target.value } }))}
                            />
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-[100px]">
                            <label className="text-[10px] font-medium text-blue-700">Invoice #</label>
                            <input
                              type="text"
                              className="text-xs border border-blue-200 rounded px-1 py-1 bg-blue-50/40 focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                              placeholder="Invoice #"
                              value={addForm.invoiceRef}
                              onChange={e => setAddingClearance(prev => ({ ...prev, [batchKey]: { ...prev[batchKey], invoiceRef: e.target.value } }))}
                            />
                          </div>
                          <div className="flex flex-col gap-0.5 min-w-[100px]">
                            <label className="text-[10px] font-medium text-emerald-700">Container #</label>
                            <input
                              type="text"
                              className="text-xs border border-emerald-200 rounded px-1 py-1 bg-emerald-50/40 focus:outline-none focus:ring-1 focus:ring-emerald-400 w-full"
                              placeholder="Container #"
                              value={addForm.containerRef}
                              onChange={e => setAddingClearance(prev => ({ ...prev, [batchKey]: { ...prev[batchKey], containerRef: e.target.value } }))}
                            />
                          </div>
                          <div className="flex gap-1">
                            <button
                              className="text-xs bg-teal-600 text-white px-3 py-1 rounded hover:bg-teal-700 transition-colors font-medium disabled:opacity-50"
                              disabled={!addForm.qty || !addForm.clearedDate || addClearanceEvent.isPending}
                              onClick={() => {
                                const qty = parseFloat(addForm.qty);
                                if (isNaN(qty) || qty <= 0) { toast.error("Enter a valid cleared quantity"); return; }
                                addClearanceEvent.mutate({
                                  skuId: batch.sku.id,
                                  periodId: batch.period.id,
                                  country: country as "Syria" | "Libya",
                                  clearedQty: qty.toString(),
                                  clearedDate: addForm.clearedDate,
                                  pendingClearDate: addForm.pendingClearDate || null,
                                  invoiceRef: addForm.invoiceRef || null,
                                  containerRef: addForm.containerRef || null,
                                  username: appUser?.displayName,
                                  skuName: batch.sku.name,
                                  periodLabel: batch.period.label,
                                }, {
                                  onSuccess: () => setAddingClearance(prev => { const n = { ...prev }; delete n[batchKey]; return n; }),
                                });
                              }}
                            >{addClearanceEvent.isPending ? "Saving..." : "Save"}</button>
                            <button
                              className="text-xs text-muted-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
                              onClick={() => setAddingClearance(prev => { const n = { ...prev }; delete n[batchKey]; return n; })}
                            >Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="text-xs text-teal-700 font-medium px-3 py-1.5 rounded border border-teal-200 hover:bg-teal-50 transition-colors"
                          onClick={() => setAddingClearance(prev => ({ ...prev, [batchKey]: { qty: "", clearedDate: new Date().toISOString().substring(0, 10), pendingClearDate: "", invoiceRef: "", containerRef: "" } }))}
                        >+ Add Clearance Event</button>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>
    );
  }

  // ============================================================
  // LEBANON: Original formula-based arrival view
  // ============================================================
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{config?.terms.arrival ?? "Arrival to Regie"}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Weekly arrival data per SKU per month. Grouped by Core/NPI, sorted by weight.
            <span className="ml-2 inline-flex items-center gap-1 text-[10px]">
              <span className="inline-block w-2 h-2 rounded-sm bg-blue-100 border border-blue-300"></span>
              <span className="text-blue-600">Formula cells (from Shipment)</span>
              <span className="ml-2">|</span>
              <span className="ml-2">Click editable cells to edit</span>
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ExportSheetButton sheet="arrival" country={country} label="Export Arrival" />
          <button onClick={() => setCollapsedYears(new Set(years))} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors">Collapse All</button>
          <button onClick={() => setCollapsedYears(new Set())} className="px-2 py-1 text-[10px] font-medium rounded border border-border bg-background hover:bg-muted transition-colors">Expand All</button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="sticky left-0 z-20 bg-muted px-2 py-2 text-left font-medium text-muted-foreground min-w-[50px]">Weight</th>
                  <th className="sticky left-[50px] z-20 bg-muted px-2 py-2 text-left font-medium text-muted-foreground min-w-[180px]">SKU Name</th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`year-${year}`}>
                        {!isCollapsed && yPeriods.map(p => (
                          <th key={p.id} colSpan={5} className="px-1 py-1 text-center font-bold border-l border-border text-primary min-w-[250px]">{p.label}</th>
                        ))}
                        <th className="px-2 py-1 text-center font-bold border-l-2 border-primary bg-primary/10 text-primary min-w-[70px] cursor-pointer select-none hover:bg-primary/20 transition-colors" onClick={() => toggleYear(year)} title={isCollapsed ? `Expand ${year}` : `Collapse ${year}`}>
                          <span className="inline-flex items-center gap-1 justify-center">
                            <svg className={`w-3 h-3 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                            FY {year}
                          </span>
                        </th>
                      </Fragment>
                    );
                  })}
                </tr>
                <tr className="bg-muted border-b">
                  <th className="sticky left-0 z-20 bg-muted px-2 py-1"></th>
                  <th className="sticky left-[50px] z-20 bg-muted px-2 py-1"></th>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`sub-year-${year}`}>
                        {!isCollapsed && yPeriods.map(p => (
                          <Fragment key={`sub-${p.id}`}>
                            <th className="px-1 py-1 text-center text-muted-foreground min-w-[45px] text-[10px]">W1</th>
                            <th className="px-1 py-1 text-center text-muted-foreground min-w-[45px] text-[10px]">W2</th>
                            <th className="px-1 py-1 text-center text-muted-foreground min-w-[45px] text-[10px]">W3</th>
                            <th className="px-1 py-1 text-center text-muted-foreground min-w-[45px] text-[10px]">W4</th>
                            <th className="px-1 py-1 text-center font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-800 min-w-[55px] text-[10px]">Total</th>
                          </Fragment>
                        ))}
                        <th className="px-2 py-1 text-center text-[10px] font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-800">{isCollapsed ? year : "Total"}</th>
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {groupedSkus.map(group => (
                  <Fragment key={`group-${group.category}`}>
                    <tr className={`${group.category === "Core" ? "bg-emerald-50" : "bg-violet-50"} cursor-pointer select-none hover:brightness-95 transition-all`} onClick={() => toggleCategory(group.category)}>
                      <td colSpan={totalColCount} className="px-3 py-1.5 font-bold text-xs tracking-wider uppercase sticky left-0 z-10" style={{ color: group.category === "Core" ? "#047857" : "#6d28d9" }}>
                        <span className="inline-flex items-center gap-2">
                          <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsedCategories.has(group.category) ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                          {group.category}
                          <span className="font-normal normal-case text-[10px] text-muted-foreground">({group.skus.length} SKUs){collapsedCategories.has(group.category) ? ' — collapsed' : ''}</span>
                        </span>
                      </td>
                    </tr>
                    {!collapsedCategories.has(group.category) && group.skus.map((sku, idx) => (
                      <tr key={sku.id} className={`border-b hover:bg-muted ${idx % 2 === 1 ? 'bg-slate-50' : ''}`}>
                        <td className={`sticky left-0 z-10 ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-background'} px-2 py-1.5`}>
                          <div className="flex flex-col items-start gap-0.5">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${sku.weight === '50g' ? 'bg-blue-100 text-blue-700' : sku.weight === '250g' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{sku.weight}</span>
                            {(sku as any).packagingType && (
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                                ((sku as any).packagingType ?? 'New') === 'New' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                              }`}>{(sku as any).packagingType === 'Old' ? 'Old Pkg' : 'New Pkg'}</span>
                            )}
                          </div>
                        </td>
                        <td className={`sticky left-[50px] z-10 ${idx % 2 === 1 ? 'bg-slate-50' : 'bg-background'} px-2 py-1.5 font-medium whitespace-nowrap border-r border-border`}>{sku.name}</td>
                        {periodsByYear.map(({ year, periods: yPeriods }) => {
                          const isYearCollapsed = collapsedYears.has(year);
                          return (
                            <Fragment key={`sku-year-${sku.id}-${year}`}>
                              {!isYearCollapsed && yPeriods.map(p => {
                                const weekInfos = ["week1","week2","week3","week4"].map(wk => ({ key: wk, ...getCellInfo(sku.id, p, wk) }));
                                const total = weekInfos.reduce((s, w) => s + w.value, 0);
                                return (
                                  <Fragment key={`${sku.id}-${p.id}`}>
                                    {weekInfos.map(w => {
                                      const cellKey = `${sku.id}-${p.id}-${w.key}`;
                                      const isEditing = editingCell === cellKey;
                                      if (w.isFormula) return <td key={cellKey} className="px-1 py-1.5 text-right tabular-nums bg-blue-50 text-blue-800" title="Formula: derived from Shipment">{formatNumber(w.value)}</td>;
                                      if (isEditing) return (
                                        <td key={cellKey} className="px-0.5 py-0.5">
                                          <input type="number" value={editValue} onChange={e => setEditValue(e.target.value)} onBlur={() => handleCellSave(sku.id, p.id, w.key)} onKeyDown={e => handleCellKeyDown(e, sku.id, p.id, w.key)} autoFocus className="w-full px-1 py-0.5 text-right text-xs border border-primary rounded bg-primary/5 focus:outline-none" />
                                        </td>
                                      );
                                      return (
                                        <td key={cellKey} className="px-1 py-1.5 text-right tabular-nums cursor-pointer hover:bg-primary/10 transition-colors" onClick={() => handleCellClick(cellKey, w.value.toString())}>
                                          {formatNumber(w.value)}
                                        </td>
                                      );
                                    })}
                                    <td className="px-1 py-1.5 text-right font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-900">{formatNumber(total)}</td>
                                  </Fragment>
                                );
                              })}
                              <td className="px-2 py-1.5 text-right border-l-2 border-amber-400 bg-amber-50 font-bold text-amber-900">{formatNumber(getFullYearTotal(sku.id, yPeriods))}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                    {/* Category subtotal */}
                    {!collapsedCategories.has(group.category) && (
                      <tr className="bg-muted/20 border-y border-border font-semibold">
                        <td className="sticky left-0 z-10 bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground" colSpan={2}>{group.category} Total</td>
                        {periodsByYear.map(({ year, periods: yPeriods }) => {
                          const isYearCollapsed = collapsedYears.has(year);
                          return (
                            <Fragment key={`cat-total-${group.category}-${year}`}>
                              {!isYearCollapsed && yPeriods.map(p => (
                                <Fragment key={`cat-total-${group.category}-${p.id}`}>
                                  {["week1","week2","week3","week4"].map((wk, i) => (
                                    <td key={wk} className={`px-1 py-1 text-right border-l ${i === 0 ? "border-border" : "border-border/30"} text-muted-foreground`}>{formatNumber(computeCatWeekTotal(group.category, p, wk))}</td>
                                  ))}
                                  <td className="px-1 py-1 text-right border-l-2 border-amber-400 bg-amber-50 font-bold text-amber-900">{formatNumber(computeCatMonthTotal(group.category, p))}</td>
                                </Fragment>
                              ))}
                              <td className="px-2 py-1 text-right border-l-2 border-amber-400 bg-amber-50 font-bold text-amber-900">{formatNumber(computeCatFullYearTotal(group.category, yPeriods))}</td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    )}
                  </Fragment>
                ))}
                {/* Grand total */}
                <tr className="bg-primary/10 border-t-2 border-primary font-bold text-primary">
                  <td className="sticky left-0 z-10 bg-primary/10 px-2 py-2 text-[11px]" colSpan={2}>Grand Total</td>
                  {periodsByYear.map(({ year, periods: yPeriods }) => {
                    const isYearCollapsed = collapsedYears.has(year);
                    return (
                      <Fragment key={`grand-total-${year}`}>
                        {!isYearCollapsed && yPeriods.map(p => (
                          <Fragment key={`grand-total-${p.id}`}>
                            {["week1","week2","week3","week4"].map((wk, i) => (
                              <td key={wk} className={`px-1 py-2 text-right border-l ${i === 0 ? "border-border" : "border-border/30"}`}>{formatNumber(computeGrandWeekTotal(p, wk))}</td>
                            ))}
                            <td className="px-1 py-2 text-right border-l-2 border-amber-400 bg-amber-100 font-bold text-amber-900">{formatNumber(computeGrandMonthTotal(p))}</td>
                          </Fragment>
                        ))}
                        <td className="px-2 py-2 text-right border-l-2 border-amber-400 bg-amber-100 font-bold text-amber-900">{formatNumber(computeGrandFullYearTotal(yPeriods))}</td>
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
