import { Fragment, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { useCountry } from "@/contexts/CountryContext";
import { useUnit } from "@/contexts/UnitContext";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useGridNav } from "@/hooks/useGridNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import ExportSheetButton from "@/components/ExportSheetButton";
import ImportSheetButton from "@/components/ImportSheetButton";
import { computeArrivalDate } from "./ShipmentPage";

// Row labels for the Planning FG table (Syria/Libya)
const ROW_LABELS = [
  "Opening Stock",
  "Adjustments",
  "Production",
  "Actual arrivals / Planned Orders",
  "IMS",
  "Closing Stock",
  "Closing Stock - Weeks",
] as const;
type RowLabel = typeof ROW_LABELS[number];

// Rows where year total should show "—" (not summable)
const NO_TOTAL_ROWS = new Set<RowLabel>(["Opening Stock", "Closing Stock - Weeks"]);

// Editable for current month + future (uses isFuturePeriod: month >= currentMonth)
const FUTURE_EDITABLE_ROWS = new Set<RowLabel>(["Adjustments", "IMS"]);
// Editable for strictly future months only — next month and beyond (uses isStrictlyFuture: month > currentMonth)
const STRICTLY_FUTURE_EDITABLE_ROWS = new Set<RowLabel>(["Production"]);

const DEFAULT_HEALTHY_MIN = 4;
const DEFAULT_HEALTHY_MAX = 6;

// Conditional formatting for Closing Stock - Weeks
function getWeeksStyle(weeks: number, minHealthy = DEFAULT_HEALTHY_MIN, maxHealthy = DEFAULT_HEALTHY_MAX): string {
  if (weeks === 0) return "bg-gray-200 text-gray-500 font-bold";
  if (weeks < 0) return "bg-gray-900 text-white font-bold";
  if (!isFinite(weeks)) return "bg-purple-200 text-purple-900 font-bold";
  if (weeks < minHealthy) return "bg-red-600 text-white font-bold";
  if (weeks <= maxHealthy) return "text-emerald-700 font-bold";
  return "bg-orange-400 text-white font-bold";
}

function getClosingStockStyle(val: number): string {
  if (val < 0) return "bg-red-100 text-red-800 font-bold";
  return "";
}

interface Period {
  id: number;
  year: number;
  month: number;
  label: string;
  sortOrder: number;
}

interface IntlPlanningFgPageProps {
  weight?: "50g" | "250g" | "1kg";
}

/**
 * Given a production period and offset, return the period id the arrival falls into.
 * Only counts if the batch has arrivalStatus === "Cleared".
 */
function getArrivalPeriodId(
  prodYear: number,
  prodMonth: number,
  offsetValue: number,
  offsetUnit: string,
  allPeriods: Period[]
): number | null {
  if (offsetValue <= 0) return null;
  const arrDate = computeArrivalDate(prodYear, prodMonth, offsetValue, offsetUnit);
  const arrYear = arrDate.getFullYear();
  const arrMonth = arrDate.getMonth() + 1;
  const match = allPeriods.find((p) => p.year === arrYear && p.month === arrMonth);
  return match?.id ?? null;
}

export default function IntlPlanningFgPage({ weight }: IntlPlanningFgPageProps) {
  const { user: appUser } = useAppAuth();
  const { country } = useCountry();
  const { formatVal, unitLabel } = useUnit();
  const utils = trpc.useUtils();

  const { data, isLoading, isFetching, refetch } = trpc.country.planningFg.useQuery(
    { country: country as "Syria" | "Libya" },
    { enabled: country === "Syria" || country === "Libya", staleTime: 0, refetchOnWindowFocus: true, refetchInterval: 30000 }
  );

  const updateCell = trpc.country.updatePlanningFgCell.useMutation({
    onSuccess: () => {
      utils.country.planningFg.invalidate();
      utils.country.data.invalidate();
    },
    onError: (err: any) => toast.error("Failed to save: " + err.message),
  });

  const updateImsMut = trpc.country.updateIms.useMutation({
    onSuccess: () => {
      utils.country.planningFg.invalidate();
      utils.country.data.invalidate();
    },
    onError: (err: any) => toast.error("Failed to save IMS: " + err.message),
  });

  const updateProductionMut = trpc.country.updateProduction.useMutation({
    onSuccess: () => {
      utils.country.planningFg.invalidate();
      utils.country.data.invalidate();
    },
    onError: (err: any) => toast.error("Failed to save Production: " + err.message),
  });

  // ── Current period detection ───────────────────────────────────────────────
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const isFuturePeriod = useCallback((p: { year: number; month: number }) => {
    return p.year > currentYear || (p.year === currentYear && p.month >= currentMonth);
  }, [currentYear, currentMonth]);

  const isStrictlyFuture = useCallback((p: { year: number; month: number }) => {
    return p.year > currentYear || (p.year === currentYear && p.month > currentMonth);
  }, [currentYear, currentMonth]);

  // ── Local edit state ──────────────────────────────────────────────────────
  const [editingCell, setEditingCell] = useState<{
    skuId: number;
    periodId: number;
    label: RowLabel;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  // ── Year collapse state ───────────────────────────────────────────────────
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());

  const toggleYear = (year: number) => {
    setCollapsedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  // ── Healthy weeks config (per-SKU, persisted to localStorage) ────────────
  const STORAGE_KEY = `healthyWeeks-${country}`;
  const [healthyWeeksConfig, setHealthyWeeksConfig] = useState<Record<number, { min: number; max: number }>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [showHealthySettings, setShowHealthySettings] = useState(false);

  const getHealthy = useCallback((skuId: number) => {
    return healthyWeeksConfig[skuId] ?? { min: DEFAULT_HEALTHY_MIN, max: DEFAULT_HEALTHY_MAX };
  }, [healthyWeeksConfig]);

  const setHealthy = (skuId: number, min: number, max: number) => {
    const next = { ...healthyWeeksConfig, [skuId]: { min, max } };
    setHealthyWeeksConfig(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
  };

  // ── Filter state ──────────────────────────────────────────────────────────
  const [searchText, setSearchText] = useState("");
  const [sizeFilter, setSizeFilter] = useState<"All" | "50g" | "250g" | "1kg">("All");
  const [packagingFilter, setPackagingFilter] = useState<"All" | "New" | "Old">("All");

  const hasActiveFilters = searchText.trim() !== "" || sizeFilter !== "All" || packagingFilter !== "All";

  const clearFilters = () => {
    setSearchText("");
    setSizeFilter("All");
    setPackagingFilter("All");
  };

  // ── Data maps ─────────────────────────────────────────────────────────────
  const imsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.ims ?? [])
      m.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
    return m;
  }, [data]);

  const shipmentMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.shipment ?? []) {
      const total =
        (parseFloat(d.week1 ?? "0") || 0) +
        (parseFloat(d.week2 ?? "0") || 0) +
        (parseFloat(d.week3 ?? "0") || 0) +
        (parseFloat(d.week4 ?? "0") || 0);
      m.set(`${d.skuId}-${d.periodId}`, total);
    }
    return m;
  }, [data]);

  const forecastMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of data?.forecast ?? [])
      m.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
    return m;
  }, [data]);

  const revisedMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of (data as any)?.revisedForecast ?? []) {
      const v = parseFloat(d.value ?? "0") || 0;
      if (v > 0) m.set(`${d.skuId}-${d.periodId}`, v);
    }
    return m;
  }, [data]);

  const planningMap = useMemo(() => {
    const m = new Map<string, { openingStock: number; adjustments: number; invoiced: number; arrivals: number }>();
    for (const d of data?.planningFg ?? []) {
      m.set(`${d.skuId}-${d.periodId}`, {
        openingStock: parseFloat(d.openingStock ?? "0") || 0,
        adjustments: parseFloat(d.adjustments ?? "0") || 0,
        invoiced: parseFloat(d.invoiced ?? "0") || 0,
        arrivals: parseFloat(d.arrivals ?? "0") || 0,
      });
    }
    return m;
  }, [data]);

  /**
   * Build arrivals map from clearance events.
   * Each clearance event's clearedQty is placed in the period matching its clearedDate (year + month).
   * This ensures cleared qty shows in the month it was actually cleared, not the production month.
   */
  const arrivalFromProductionMap = useMemo(() => {
    const m = new Map<string, number>();
    const allPeriods = (data?.periods ?? []) as Period[];
    const events = (data as any)?.clearanceEvents ?? [];
    for (const ev of events) {
      if (!ev.clearedDate || !ev.clearedQty) continue;
      const qty = parseFloat(ev.clearedQty);
      if (!qty || qty <= 0) continue;
      // Parse the cleared date to get year + month
      const dateStr = typeof ev.clearedDate === "string" ? ev.clearedDate : (ev.clearedDate as Date).toISOString();
      const cleared = new Date(dateStr);
      const clearedYear = cleared.getFullYear();
      const clearedMonth = cleared.getMonth() + 1; // 1-based
      // Find the planning period matching this year + month
      const matchPeriod = allPeriods.find(p => p.year === clearedYear && p.month === clearedMonth);
      if (!matchPeriod) continue;
      const key = `${ev.skuId}-${matchPeriod.id}`;
      m.set(key, (m.get(key) ?? 0) + qty);
    }
    return m;
  }, [data]);

  // ── Computed rows ─────────────────────────────────────────────────────────
  /**
   * Formula: Closing Stock = Opening Stock + Adjustments + Arrivals(Cleared) - IMS
   */
  const getRowValues = useCallback(
    (skuId: number, periods: Period[]) => {
      const result = new Map<RowLabel, Map<string, number>>();
      for (const label of ROW_LABELS) result.set(label, new Map());

      for (let i = 0; i < periods.length; i++) {
        const p = periods[i];
        const key = `${skuId}-${p.id}`;
        const pg = planningMap.get(key) ?? { openingStock: 0, adjustments: 0, invoiced: 0, arrivals: 0 };
        const forecastProd = forecastMap.get(key) ?? 0;
        const revisedProd = revisedMap.get(key);
        const production = revisedProd !== undefined ? revisedProd : forecastProd;
        const ims = imsMap.get(key) ?? 0;

        // Arrivals: only Cleared batches (from production offset)
        const arrivals = arrivalFromProductionMap.get(key) ?? 0;

        // Opening Stock: first period uses stored value; subsequent = previous closing stock
        let openingStock = pg.openingStock;
        if (i > 0) {
          const prevP = periods[i - 1];
          const prevKey = `${skuId}-${prevP.id}`;
          const prevPg = planningMap.get(prevKey) ?? { openingStock: 0, adjustments: 0, invoiced: 0, arrivals: 0 };
          const prevIms = imsMap.get(prevKey) ?? 0;
          const prevArrivals = arrivalFromProductionMap.get(prevKey) ?? 0;
          const prevOpening =
            i === 1
              ? prevPg.openingStock
              : (result.get("Opening Stock")!.get(prevP.id.toString()) ?? prevPg.openingStock);
          // Previous closing: Opening + Adj + Arrivals(Cleared) - IMS
          const prevClosing = prevOpening + prevPg.adjustments + prevArrivals - prevIms;
          openingStock = prevClosing;
        }

        // Closing Stock = Opening + Adjustments + Arrivals(Cleared) - IMS
        const closingStock = openingStock + pg.adjustments + arrivals - ims;

        // Weeks of stock = (Closing / IMS) * 4
        const weeksOfStock =
          ims > 0
            ? (closingStock / ims) * 4
            : closingStock > 0
            ? Infinity
            : 0;

        result.get("Opening Stock")!.set(p.id.toString(), openingStock);
        result.get("Adjustments")!.set(p.id.toString(), pg.adjustments);
        result.get("Production")!.set(p.id.toString(), production);
        result.get("Actual arrivals / Planned Orders")!.set(p.id.toString(), arrivals);
        result.get("IMS")!.set(p.id.toString(), ims);
        result.get("Closing Stock")!.set(p.id.toString(), closingStock);
        result.get("Closing Stock - Weeks")!.set(p.id.toString(), weeksOfStock);
      }
      return result;
    },
    [planningMap, forecastMap, revisedMap, imsMap, arrivalFromProductionMap]
  );

  // ── Cell editing ──────────────────────────────────────────────────────────
  const handleCellClick = (skuId: number, period: Period, label: RowLabel, currentValue: number) => {
    if (FUTURE_EDITABLE_ROWS.has(label) && isFuturePeriod(period)) {
      setEditingCell({ skuId, periodId: period.id, label });
      setEditValue(currentValue === 0 ? "" : currentValue.toString());
    } else if (STRICTLY_FUTURE_EDITABLE_ROWS.has(label) && isStrictlyFuture(period)) {
      setEditingCell({ skuId, periodId: period.id, label });
      setEditValue(currentValue === 0 ? "" : currentValue.toString());
    }
  };

  const doSaveCurrentCell = () => {
    if (!editingCell) return;
    const newVal = editValue.trim() === "" ? "0" : editValue;
    const numVal = parseFloat(newVal);
    if (isNaN(numVal)) return;

    const { label } = editingCell;
    const period = allPeriods.find(p => p.id === editingCell.periodId);
    const sku = allSkus.find(s => s.id === editingCell.skuId);

    if (label === "IMS") {
      updateImsMut.mutate({
        skuId: editingCell.skuId,
        periodId: editingCell.periodId,
        value: newVal,
        country: country as "Syria" | "Libya",
        username: appUser?.displayName,
        skuName: sku?.name,
        periodLabel: period?.label,
      });
    } else if (label === "Production") {
      updateProductionMut.mutate({
        skuId: editingCell.skuId,
        periodId: editingCell.periodId,
        week1: newVal,
        week2: "0",
        week3: "0",
        week4: "0",
        country: country as "Syria" | "Libya",
        username: appUser?.displayName,
        skuName: sku?.name,
        periodLabel: period?.label,
      });
    } else {
      updateCell.mutate({
        skuId: editingCell.skuId,
        periodId: editingCell.periodId,
        label: editingCell.label,
        value: newVal,
        country: country as "Syria" | "Libya",
        username: appUser?.displayName,
      });
    }
  };

  const handleCellBlur = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    doSaveCurrentCell();
    setEditingCell(null);
  };

  // handleKeyDown is defined after periodsByYear (below)

  // ── Filter SKUs by weight + search + packaging ────────────────────────────
  const allSkus = data?.skus ?? [];
  const allPeriods = (data?.periods ?? []) as Period[];

  const filteredSkus = useMemo(() => {
    let skus = weight ? allSkus.filter((s) => s.weight === weight) : allSkus;

    // Size filter (only relevant when no weight prop — all-weights view)
    if (!weight && sizeFilter !== "All") {
      skus = skus.filter((s) => s.weight === sizeFilter);
    }

    // SKU name search
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      skus = skus.filter((s) => s.name.toLowerCase().includes(q));
    }

    // Packaging filter
    if (packagingFilter !== "All") {
      skus = skus.filter((s) => (s.packagingType ?? "New") === packagingFilter);
    }

    return skus;
  }, [allSkus, weight, sizeFilter, searchText, packagingFilter]);

  // ── Group periods by year ─────────────────────────────────────────────────
  const periodsByYear = useMemo(() => {
    const map = new Map<number, Period[]>();
    for (const p of allPeriods) {
      if (!map.has(p.year)) map.set(p.year, []);
      map.get(p.year)!.push(p);
    }
    return map;
  }, [allPeriods]);

  const years = useMemo(() => Array.from(periodsByYear.keys()).sort(), [periodsByYear]);

  // Build navigable cell IDs for IntlPlanningFg
  const navigableCellIds = useMemo(() => {
    const visiblePeriods: Period[] = [];
    for (const year of years) {
      if (collapsedYears.has(year)) continue;
      const yPeriods = periodsByYear.get(year) ?? [];
      visiblePeriods.push(...yPeriods.slice().sort((a, b) => a.sortOrder - b.sortOrder));
    }
    const ids: string[] = [];
    for (const sku of filteredSkus) {
      for (const p of visiblePeriods) {
        if (isFuturePeriod(p)) ids.push(`${sku.id}-${p.id}-Adjustments`);
      }
      for (const p of visiblePeriods) {
        if (isFuturePeriod(p)) ids.push(`${sku.id}-${p.id}-IMS`);
      }
      for (const p of visiblePeriods) {
        if (isStrictlyFuture(p)) ids.push(`${sku.id}-${p.id}-Production`);
      }
    }
    return ids;
  }, [filteredSkus, years, periodsByYear, collapsedYears, isFuturePeriod, isStrictlyFuture]);

  const visiblePeriodCount = useMemo(() => {
    let count = 0;
    for (const year of years) {
      if (collapsedYears.has(year)) continue;
      count += (periodsByYear.get(year) ?? []).length;
    }
    return count;
  }, [years, periodsByYear, collapsedYears]);

  const { handleNavKeyDown } = useGridNav({
    cellIds: navigableCellIds,
    editingCell: editingCell ? `${editingCell.skuId}-${editingCell.periodId}-${editingCell.label}` : null,
    setEditingCell: (id) => {
      if (id === null) { setEditingCell(null); return; }
      const firstDash = id.indexOf("-");
      const secondDash = id.indexOf("-", firstDash + 1);
      const skuId = parseInt(id.slice(0, firstDash));
      const periodId = parseInt(id.slice(firstDash + 1, secondDash));
      const label = id.slice(secondDash + 1) as RowLabel;
      // Get current value
      const planData = planningMap.get(`${skuId}-${periodId}`);
      let val = 0;
      if (label === "Adjustments") val = planData?.adjustments ?? 0;
      else if (label === "IMS") val = imsMap.get(`${skuId}-${periodId}`) ?? 0;
      else if (label === "Production") {
        const revised = revisedMap.get(`${skuId}-${periodId}`);
        val = revised !== undefined ? revised : (forecastMap.get(`${skuId}-${periodId}`) ?? 0);
      }
      setEditingCell({ skuId, periodId, label });
      setEditValue(val === 0 ? "" : val.toString());
    },
    onSave: (_cellId) => {
      doSaveCurrentCell();
      skipBlurRef.current = true;
    },
    onCancel: () => setEditingCell(null),
    colCount: visiblePeriodCount,
  });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!editingCell) return;
    handleNavKeyDown(e, `${editingCell.skuId}-${editingCell.periodId}-${editingCell.label}`);
  };

  // ── Loading / empty states ────────────────────────────────────────────────
  if (isLoading) return <TableSkeleton title="Planning FG" rows={12} cols={8} />;

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

  if (allPeriods.length === 0) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <p className="text-lg font-medium mb-2">No planning periods found for {country}</p>
            <p className="text-sm">Use "Add Year" on the dashboard to create planning periods first.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const baseSkuCount = weight ? allSkus.filter((s) => s.weight === weight).length : allSkus.length;

  const pageTitle = weight ? `Planning FG ${weight} — ${country}` : `Planning FG — ${country}`;

  // Row styling helpers
  const rowBg: Record<RowLabel, string> = {
    "Opening Stock": "hover:bg-blue-50/50",
    "Adjustments": "hover:bg-blue-50/50",
    "Production": "bg-blue-50/20",
    "Actual arrivals / Planned Orders": "bg-emerald-50/30",
    "IMS": "bg-orange-50/30",
    "Closing Stock": "",
    "Closing Stock - Weeks": "bg-amber-50/30",
  };

  const labelStyle: Record<RowLabel, string> = {
    "Opening Stock": "text-blue-700 bg-blue-50",
    "Adjustments": "text-blue-700 bg-blue-50",
    "Production": "text-blue-600 bg-blue-50",
    "Actual arrivals / Planned Orders": "text-emerald-700 bg-emerald-50",
    "IMS": "text-orange-700 bg-orange-50",
    "Closing Stock": "text-foreground bg-white",
    "Closing Stock - Weeks": "text-amber-700 bg-amber-50",
  };

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{pageTitle}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredSkus.length} of {baseSkuCount} SKU{baseSkuCount !== 1 ? "s" : ""} · Formula: Opening + Adj + Arrivals (Cleared) − IMS
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setCollapsedYears(new Set(years))}>
            Collapse All Years
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCollapsedYears(new Set())}>
            Expand All Years
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5"
          >
            <svg className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {isFetching ? 'Syncing...' : 'Sync All'}
          </Button>
          {weight && (
            <>
              <ImportSheetButton sheet={`planning-fg-${weight}`} country={country} label={`Import`} />
              <ExportSheetButton sheet={`planning-fg-${weight}`} country={country} label={`Export Planning FG ${weight}`} />
            </>
          )}
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
        {/* SKU search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <Input
            placeholder="Search SKU name…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* Size filter — only shown when no weight prop */}
        {!weight && (
          <div className="flex items-center gap-1">
            <span className="text-xs text-muted-foreground font-medium mr-1">Size:</span>
            {(["All", "50g", "250g", "1kg"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSizeFilter(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  sizeFilter === s
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* Packaging filter */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground font-medium mr-1">Packaging:</span>
          {(["All", "New", "Old"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPackagingFilter(p)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                packagingFilter === p
                  ? p === "New"
                    ? "bg-green-600 text-white border-green-600"
                    : p === "Old"
                    ? "bg-orange-500 text-white border-orange-500"
                    : "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Clear
          </button>
        )}
      </div>

      {/* Empty state after filtering */}
      {filteredSkus.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            <p className="text-lg font-medium mb-2">No SKUs match the current filters</p>
            <p className="text-sm">Try adjusting your search or filter criteria.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>
              Clear filters
            </Button>
          </CardContent>
        </Card>
      )}

      {/* SKU tables */}
      {filteredSkus.map((sku) => {
        const rowValues = getRowValues(sku.id, allPeriods);

        return (
          <Card key={sku.id} className="overflow-hidden">
            <CardHeader className="py-3 px-4 bg-muted/30 border-b">
              <CardTitle className="text-sm font-semibold flex items-center gap-2 justify-between">
                <div className="flex items-center gap-2">
                  <span>{sku.name}</span>
                  <span className="text-xs font-normal text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {sku.weight}
                  </span>
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    (sku.packagingType ?? 'New') === 'New' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-700'
                  }`}>
                    {sku.packagingType ?? 'New'}
                  </span>
                </div>
                <button
                  onClick={() => refetch()}
                  disabled={isFetching}
                  className="flex items-center gap-1 text-[11px] font-medium text-primary border border-primary/30 px-2 py-1 rounded hover:bg-primary/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Sync latest data from server"
                >
                  <svg className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {isFetching ? 'Syncing...' : 'Sync'}
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-xs border-collapse min-w-max">
                <thead>
                  {/* Year header row */}
                  <tr className="bg-muted/30">
                    <th className="sticky left-0 z-10 bg-muted/30 px-3 py-1.5 text-left min-w-[240px]" />
                    {years.map((year) => {
                      const yearPeriods = periodsByYear.get(year) ?? [];
                      const isCollapsed = collapsedYears.has(year);
                      return (
                        <th
                          key={year}
                          colSpan={isCollapsed ? 1 : yearPeriods.length + 1}
                          className="px-2 py-1.5 text-center font-semibold text-muted-foreground border-l border-muted cursor-pointer hover:bg-muted/50 transition-colors select-none"
                          onClick={() => toggleYear(year)}
                          title={isCollapsed ? `Expand ${year}` : `Collapse ${year}`}
                        >
                          FY {year} {isCollapsed ? "▶" : "▼"}
                        </th>
                      );
                    })}
                  </tr>
                  {/* Month header row */}
                  <tr className="bg-muted/20">
                    <th className="sticky left-0 z-10 bg-muted/20 px-3 py-2 text-left font-medium text-muted-foreground min-w-[240px]">
                      Row
                    </th>
                    {years.map((year) => {
                      const yearPeriods = periodsByYear.get(year) ?? [];
                      const isCollapsed = collapsedYears.has(year);
                      if (isCollapsed) {
                        return (
                          <th key={year} className="px-2 py-2 text-center font-medium text-muted-foreground min-w-[70px] whitespace-nowrap border-l border-muted">
                            Total
                          </th>
                        );
                      }
                      return (
                        <Fragment key={`hdr-${year}`}>
                          {yearPeriods.map((p) => (
                            <th key={p.id} className="px-2 py-2 text-center font-medium text-muted-foreground min-w-[70px] whitespace-nowrap">
                              {p.label}
                            </th>
                          ))}
                          {/* Year Total column header */}
                          <th className="px-2 py-2 text-center font-bold text-amber-800 min-w-[80px] whitespace-nowrap border-l-2 border-amber-400 bg-amber-50">
                            Total
                          </th>
                        </Fragment>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {ROW_LABELS.map((label) => {
                    const isFutureEditable = FUTURE_EDITABLE_ROWS.has(label);
                    const isStrictlyFutureEditable = STRICTLY_FUTURE_EDITABLE_ROWS.has(label);
                    const isClosingWeeks = label === "Closing Stock - Weeks";
                    const isClosingStock = label === "Closing Stock";
                    const isArrivals = label === "Actual arrivals / Planned Orders";
                    const isIms = label === "IMS";
                    const isSeparatorBefore = label === "Closing Stock";
                    const showTotal = !NO_TOTAL_ROWS.has(label);

                    return (
                      <tr
                        key={label}
                        className={`border-t ${isSeparatorBefore ? "border-t-2 border-muted" : ""} ${rowBg[label]}`}
                      >
                        {/* Row label */}
                        <td className={`sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap ${labelStyle[label]}`}>
                          <span className="flex items-center gap-1">
                            {label}
                            {isClosingWeeks && (
                              <button
                                onClick={() => setShowHealthySettings(true)}
                                className="ml-1 text-muted-foreground hover:text-primary transition-colors"
                                title="Configure healthy stock weeks per SKU"
                              >
                                <Settings size={12} />
                              </button>
                            )}
                            {isFutureEditable && (
                              <span className="text-[9px] text-blue-400">(editable: current+future)</span>
                            )}
                            {isStrictlyFutureEditable && (
                              <span className="text-[9px] text-blue-400">(revised if available, else forecast)</span>
                            )}
                            {label === "Opening Stock" && (
                              <span className="text-[9px] text-gray-400">(auto)</span>
                            )}
                            {(label === "Closing Stock" || label === "Closing Stock - Weeks") && (
                              <span className="text-[9px] text-gray-400">(auto)</span>
                            )}
                            {isArrivals && (
                              <span className="text-[9px] text-emerald-500">(Cleared only)</span>
                            )}
                          </span>
                        </td>

                        {/* Data cells */}
                        {years.map((year) => {
                          const yearPeriods = periodsByYear.get(year) ?? [];
                          const isCollapsed = collapsedYears.has(year);

                          if (isCollapsed) {
                            const yearTotal = yearPeriods.reduce(
                              (sum, p) => sum + (rowValues.get(label)?.get(p.id.toString()) ?? 0),
                              0
                            );
                            if (isClosingWeeks) {
                              const avgWeeks = yearTotal / yearPeriods.length;
                              const { min: hMin, max: hMax } = getHealthy(sku.id);
                              return (
                                <td key={year} className={`px-2 py-1.5 text-center border-l border-muted ${getWeeksStyle(avgWeeks, hMin, hMax)}`}>
                                  {!isFinite(avgWeeks) ? "∞" : avgWeeks.toFixed(1)}
                                </td>
                              );
                            }
                            return (
                              <td key={year} className={`px-2 py-1.5 text-right font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-900 ${isClosingStock ? getClosingStockStyle(yearTotal) : ""}`}>
                                {yearTotal === 0 ? "—" : formatVal(yearTotal)}
                              </td>
                            );
                          }

                          // Expanded: render month cells + year total cell
                          let yearTotal = 0;
                          const cells: React.ReactNode[] = yearPeriods.map((p) => {
                            const val = rowValues.get(label)?.get(p.id.toString()) ?? 0;
                            if (showTotal) yearTotal += val;

                            const isActive =
                              editingCell?.skuId === sku.id &&
                              editingCell?.periodId === p.id &&
                              editingCell?.label === label;

                            if (isClosingWeeks) {
                              const { min: hMin, max: hMax } = getHealthy(sku.id);
                              return (
                                <td key={p.id} className={`px-2 py-1.5 text-center ${getWeeksStyle(val, hMin, hMax)}`}>
                                  {!isFinite(val) ? "∞" : val.toFixed(1)}
                                </td>
                              );
                            }

                            if (isClosingStock) {
                              return (
                                <td key={p.id} className={`px-2 py-1.5 text-right font-medium ${getClosingStockStyle(val)}`}>
                                  {val === 0 ? "—" : formatVal(val)}
                                </td>
                              );
                            }

                            const cellEditable = (isFutureEditable && isFuturePeriod(p))
                              || (isStrictlyFutureEditable && isStrictlyFuture(p));

                            if (cellEditable) {
                              return (
                                <td
                                  key={p.id}
                                  className="px-2 py-1.5 text-right cursor-pointer hover:bg-blue-100/60"
                                  onClick={() => handleCellClick(sku.id, p, label, val)}
                                >
                                  {isActive ? (
                                    <input
                                      ref={inputRef}
                                      type="number"
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onBlur={handleCellBlur}
                                      onKeyDown={handleKeyDown}
                                      className="w-full text-right bg-blue-50 border border-blue-300 rounded px-1 py-0 text-xs outline-none"
                                      style={{ minWidth: 60 }}
                                    />
                                  ) : (
                                    <span className={val === 0 ? "text-muted-foreground/50" : ""}>
                                      {val === 0 ? "—" : formatVal(val)}
                                    </span>
                                  )}
                                </td>
                              );
                            }

                            // Read-only: Production, Arrivals, IMS
                            return (
                              <td
                                key={p.id}
                                className={`px-2 py-1.5 text-right ${
                                  isArrivals
                                    ? val > 0 ? "text-emerald-700 font-medium" : "text-muted-foreground"
                                    : isIms
                                    ? val > 0 ? "text-orange-700 font-medium" : "text-muted-foreground"
                                    : "text-muted-foreground"
                                }`}
                              >
                                {val === 0 ? "—" : formatVal(val)}
                              </td>
                            );
                          });

                          // Year total cell
                          let totalCell: React.ReactNode;
                          if (!showTotal) {
                            totalCell = (
                              <td key={`total-${year}`} className="px-2 py-1.5 text-center text-amber-300 border-l-2 border-amber-400 bg-amber-50">
                                —
                              </td>
                            );
                          } else if (isClosingWeeks) {
                            const avgWeeks = yearTotal / yearPeriods.length;
                            const { min: hMin, max: hMax } = getHealthy(sku.id);
                            totalCell = (
                              <td key={`total-${year}`} className={`px-2 py-1.5 text-center border-l-2 border-amber-400 bg-amber-50 font-bold ${getWeeksStyle(avgWeeks, hMin, hMax)}`}>
                                {!isFinite(avgWeeks) ? "∞" : avgWeeks.toFixed(1)}
                              </td>
                            );
                          } else if (isClosingStock) {
                            totalCell = (
                              <td key={`total-${year}`} className={`px-2 py-1.5 text-right font-bold border-l-2 border-amber-400 bg-amber-50 ${getClosingStockStyle(yearTotal)}`}>
                                {yearTotal === 0 ? "—" : formatVal(yearTotal)}
                              </td>
                            );
                          } else {
                            totalCell = (
                              <td key={`total-${year}`} className={`px-2 py-1.5 text-right font-bold border-l-2 border-amber-400 bg-amber-50 ${
                                isArrivals ? "text-emerald-700" : isIms ? "text-orange-700" : "text-amber-900"
                              }`}>
                                {yearTotal === 0 ? "—" : formatVal(yearTotal)}
                              </td>
                            );
                          }

                          return (
                            <Fragment key={`expanded-${year}`}>
                              {cells}
                              {totalCell}
                            </Fragment>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })}

      {/* ── Healthy Weeks Settings Dialog ──────────────────────────────────── */}
      <Dialog open={showHealthySettings} onOpenChange={setShowHealthySettings}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Healthy Stock Weeks — Per SKU Settings</DialogTitle>
          </DialogHeader>
          <DialogDescription className="mb-3">
            Set the healthy closing stock range (in weeks) for each SKU. Cells outside this range will be highlighted in red (too low) or orange (too high). Default: {DEFAULT_HEALTHY_MIN}–{DEFAULT_HEALTHY_MAX} weeks.
          </DialogDescription>
          <div className="space-y-2">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_80px_80px_80px] gap-2 text-xs font-semibold text-muted-foreground px-1">
              <span>SKU</span>
              <span className="text-center">Min wks</span>
              <span className="text-center">Max wks</span>
              <span className="text-center">Reset</span>
            </div>
            {filteredSkus.map(sku => {
              const { min, max } = getHealthy(sku.id);
              const isDefault = min === DEFAULT_HEALTHY_MIN && max === DEFAULT_HEALTHY_MAX;
              return (
                <div key={sku.id} className="grid grid-cols-[1fr_80px_80px_80px] gap-2 items-center px-1 py-0.5 rounded hover:bg-muted/30">
                  <span className="text-sm truncate" title={sku.name}>{sku.name}</span>
                  <input
                    type="number"
                    min={0}
                    max={52}
                    value={min}
                    onChange={e => setHealthy(sku.id, Number(e.target.value), max)}
                    className="w-full text-center border border-input rounded px-1 py-0.5 text-sm bg-background"
                  />
                  <input
                    type="number"
                    min={0}
                    max={52}
                    value={max}
                    onChange={e => setHealthy(sku.id, min, Number(e.target.value))}
                    className="w-full text-center border border-input rounded px-1 py-0.5 text-sm bg-background"
                  />
                  <button
                    onClick={() => setHealthy(sku.id, DEFAULT_HEALTHY_MIN, DEFAULT_HEALTHY_MAX)}
                    className={`text-xs px-1 py-0.5 rounded ${isDefault ? "text-muted-foreground/40 cursor-default" : "text-blue-500 hover:bg-blue-50"}`}
                    disabled={isDefault}
                  >
                    Reset
                  </button>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-600 inline-block" /> Below min</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-100 border border-emerald-500 inline-block" /> In range</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block" /> Above max</span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
