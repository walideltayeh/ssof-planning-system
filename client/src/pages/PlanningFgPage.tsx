import { Fragment, useMemo, useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { TableSkeleton } from "@/components/TableSkeleton";
import { useGridNav } from "@/hooks/useGridNav";
import { useAppAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import SkuRecommendations from "@/components/SmartRecommendations";
import BestStrategy from "@/components/BestStrategy";
import { InvoicedSHPDialog } from "@/components/InvoicedSHPDialog";

interface PlanningFgPageProps {
  weight: string;
}

const ROW_LABELS = [
  "Opening Stock",
  "Adjustments",
  "IMS",
  "Invoiced (SHP)",
  "Actual arrivals / Planned Orders",
  "Closing Stock",
  "Closing Stock - Weeks",
] as const;

type RowLabel = typeof ROW_LABELS[number];

// ── Undo/Redo history entry ──────────────────────────────────────────────────
interface UndoEntry {
  type: "planningFgCell" | "syncIms" | "invoicedSHP" | "imsDirect" | "syncArrival";
  skuId: number;
  periodId: number;
  label: string;
  oldValue: string;
  newValue: string;
  skuName: string;
  periodLabel: string;
  // For invoicedSHP undo, store the old weekly breakdown
  oldWeeks?: { week1: number; week2: number; week3: number; week4: number };
}

// ── Excel-matching conditional formatting for Closing Stock - Weeks ──────────
function getWeeksStyle(weeks: number): string {
  if (!isFinite(weeks) && weeks > 0) return "bg-purple-200 text-purple-900 font-bold";
  if (!isFinite(weeks) && weeks < 0) return "bg-gray-900 text-white font-bold";
  if (weeks === 0)   return "bg-gray-200 text-gray-500 font-bold";
  if (weeks < 0)     return "bg-gray-900 text-white font-bold";
  if (weeks < 4)     return "bg-red-600 text-white font-bold";
  if (weeks <= 6)    return "text-emerald-700 font-bold";
  return "bg-red-600 text-white font-bold";
}

function getClosingStockStyle(val: number): string {
  if (val < 0) return "bg-red-100 text-red-800 font-bold";
  return "";
}

export default function PlanningFgPage({ weight }: PlanningFgPageProps) {
  const { user: appUser } = useAppAuth();
  const { data, isLoading } = trpc.data.planningFg.useQuery({ weight });
  const utils = trpc.useUtils();

  // ── Per-SKU undo stacks ────────────────────────────────────────────────────
  const [undoStacks, setUndoStacks] = useState<Map<number, UndoEntry[]>>(new Map());
  // ── Per-SKU redo stacks ────────────────────────────────────────────────────
  const [redoStacks, setRedoStacks] = useState<Map<number, UndoEntry[]>>(new Map());
  const [isUndoing, setIsUndoing] = useState(false);
  const [isRedoing, setIsRedoing] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [collapsedYears, setCollapsedYears] = useState<Set<number>>(new Set());

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

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStacks(prev => {
      const next = new Map(prev);
      const stack = [...(next.get(entry.skuId) ?? []), entry];
      next.set(entry.skuId, stack);
      return next;
    });
    // Clear redo stack for this SKU when a new edit is made (standard undo/redo behavior)
    setRedoStacks(prev => {
      const next = new Map(prev);
      next.delete(entry.skuId);
      return next;
    });
  }, []);

  const pushRedo = useCallback((entry: UndoEntry) => {
    setRedoStacks(prev => {
      const next = new Map(prev);
      const stack = [...(next.get(entry.skuId) ?? []), entry];
      next.set(entry.skuId, stack);
      return next;
    });
  }, []);

  const getSkuUndoStack = useCallback((skuId: number) => {
    return undoStacks.get(skuId) ?? [];
  }, [undoStacks]);

  const getSkuRedoStack = useCallback((skuId: number) => {
    return redoStacks.get(skuId) ?? [];
  }, [redoStacks]);

  const updateCell = trpc.update.planningFgCell.useMutation({
    onSuccess: () => {
      utils.data.planningFg.invalidate();
      utils.data.forecast.invalidate();
      utils.data.imsVsForecast.invalidate();
      toast.success("Cell updated", { duration: 2000 });
    },
    onError: (err: any) => toast.error("Failed to save: " + err.message),
  });

  const updateForecast = trpc.update.forecastCell.useMutation({
    onSuccess: (_result, variables) => {
      const period = data?.periods.find(pp => pp.id === variables.periodId);
      if (period && isStrictlyFuture(period)) {
        syncIms.mutate({
          skuId: variables.skuId,
          periodId: variables.periodId,
          value: variables.value,
          username: variables.username,
          skuName: variables.skuName,
          periodLabel: variables.periodLabel,
          oldValue: variables.oldValue,
          source: `Planning FG ${weight} (Forecast edit)`,
        });
      } else {
        utils.data.planningFg.invalidate();
        utils.data.forecast.invalidate();
        utils.data.imsVsForecast.invalidate();
        toast.success("Forecast updated", { duration: 2000 });
      }
    },
    onError: (err: any) => toast.error("Failed to update forecast: " + err.message),
  });

  const syncIms = trpc.update.syncImsAndForecast.useMutation({
    onSuccess: () => {
      utils.data.planningFg.invalidate();
      utils.data.forecast.invalidate();
      utils.data.imsVsForecast.invalidate();
      toast.success("IMS updated & synced to Forecast", { duration: 3000 });
    },
    onError: (err: any) => toast.error("Failed to sync IMS: " + err.message),
  });

  const updateImsDirect = trpc.update.imsCell.useMutation({
    onSuccess: () => {
      utils.data.planningFg.invalidate();
      utils.data.imsVsForecast.invalidate();
      toast.success("IMS updated", { duration: 2000 });
    },
    onError: (err: any) => toast.error("Failed to update IMS: " + err.message),
  });

  const syncArrival = trpc.update.syncPlanningFgArrival.useMutation({
    onSuccess: () => {
      utils.data.planningFg.invalidate();
      toast.success("Arrivals updated & synced to source", { duration: 3000 });
    },
    onError: (err: any) => toast.error("Failed to sync arrivals: " + err.message),
  });

  // ── Per-SKU undo handler ──────────────────────────────────────────────────
  const handleUndoForSku = useCallback((skuId: number) => {
    const stack = undoStacks.get(skuId) ?? [];
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setIsUndoing(true);

    const onDone = () => {
      // Remove from undo stack
      setUndoStacks(prev => {
        const next = new Map(prev);
        const s = [...(next.get(skuId) ?? [])];
        s.pop();
        if (s.length === 0) next.delete(skuId);
        else next.set(skuId, s);
        return next;
      });
      // Push to redo stack
      pushRedo(entry);
      setIsUndoing(false);
      toast.success(`Undone: ${entry.label} (${entry.periodLabel}) reverted from ${entry.newValue || "0"} back to ${entry.oldValue || "0"}`, { duration: 3000 });
    };

    const onErr = (err: any) => {
      setIsUndoing(false);
      toast.error("Undo failed: " + err.message);
    };

    if (entry.type === "syncIms") {
      syncIms.mutate({
        skuId: entry.skuId,
        periodId: entry.periodId,
        value: entry.oldValue,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.newValue,
        source: `Undo - Planning FG ${weight}`,
      }, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "imsDirect") {
      updateImsDirect.mutate({
        skuId: entry.skuId,
        periodId: entry.periodId,
        value: entry.oldValue,
        isActual: true,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.newValue,
      }, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "syncArrival") {
      syncArrival.mutate({
        skuId: entry.skuId,
        periodId: entry.periodId,
        value: entry.oldValue,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.newValue,
      }, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "planningFgCell") {
      const updateData: any = {
        skuId: entry.skuId,
        periodId: entry.periodId,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.newValue,
      };
      if (entry.label === "Opening Stock") updateData.openingStock = entry.oldValue;
      else if (entry.label === "Adjustments") updateData.adjustments = entry.oldValue;
      updateCell.mutate(updateData, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "invoicedSHP") {
      const updateData: any = {
        skuId: entry.skuId,
        periodId: entry.periodId,
        invoiced: entry.oldValue,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.newValue,
      };
      updateCell.mutate(updateData, { onSuccess: onDone, onError: onErr });
    }
  }, [undoStacks, syncIms, updateImsDirect, syncArrival, updateCell, appUser, weight, pushRedo]);

  // ── Per-SKU redo handler ──────────────────────────────────────────────────
  const handleRedoForSku = useCallback((skuId: number) => {
    const stack = redoStacks.get(skuId) ?? [];
    if (stack.length === 0) return;
    const entry = stack[stack.length - 1];
    setIsRedoing(true);

    const onDone = () => {
      // Remove from redo stack
      setRedoStacks(prev => {
        const next = new Map(prev);
        const s = [...(next.get(skuId) ?? [])];
        s.pop();
        if (s.length === 0) next.delete(skuId);
        else next.set(skuId, s);
        return next;
      });
      // Push back to undo stack (without clearing redo — we're inside a redo operation)
      setUndoStacks(prev => {
        const next = new Map(prev);
        const s = [...(next.get(entry.skuId) ?? []), entry];
        next.set(entry.skuId, s);
        return next;
      });
      setIsRedoing(false);
      toast.success(`Redone: ${entry.label} (${entry.periodLabel}) re-applied ${entry.oldValue || "0"} → ${entry.newValue || "0"}`, { duration: 3000 });
    };

    const onErr = (err: any) => {
      setIsRedoing(false);
      toast.error("Redo failed: " + err.message);
    };

    // Redo = re-apply the newValue
    if (entry.type === "syncIms") {
      syncIms.mutate({
        skuId: entry.skuId,
        periodId: entry.periodId,
        value: entry.newValue,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.oldValue,
        source: `Redo - Planning FG ${weight}`,
      }, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "imsDirect") {
      updateImsDirect.mutate({
        skuId: entry.skuId,
        periodId: entry.periodId,
        value: entry.newValue,
        isActual: true,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.oldValue,
      }, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "syncArrival") {
      syncArrival.mutate({
        skuId: entry.skuId,
        periodId: entry.periodId,
        value: entry.newValue,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.oldValue,
      }, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "planningFgCell") {
      const updateData: any = {
        skuId: entry.skuId,
        periodId: entry.periodId,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.oldValue,
      };
      if (entry.label === "Opening Stock") updateData.openingStock = entry.newValue;
      else if (entry.label === "Adjustments") updateData.adjustments = entry.newValue;
      updateCell.mutate(updateData, { onSuccess: onDone, onError: onErr });
    } else if (entry.type === "invoicedSHP") {
      const updateData: any = {
        skuId: entry.skuId,
        periodId: entry.periodId,
        invoiced: entry.newValue,
        username: appUser?.displayName,
        skuName: entry.skuName,
        periodLabel: entry.periodLabel,
        oldValue: entry.oldValue,
      };
      updateCell.mutate(updateData, { onSuccess: onDone, onError: onErr });
    }
  }, [redoStacks, syncIms, updateImsDirect, syncArrival, updateCell, appUser, weight]);

  // ── Ctrl+Z keyboard shortcut (undoes last edit across all SKUs) ────────────
  const handleGlobalUndo = useCallback(() => {
    // Find the most recent entry across all SKU stacks
    let latestEntry: UndoEntry | null = null;
    let latestSkuId = 0;
    for (const [skuId, stack] of Array.from(undoStacks)) {
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (!latestEntry) { latestEntry = top; latestSkuId = skuId; }
        else { latestEntry = top; latestSkuId = skuId; } // last one wins (most recently pushed)
      }
    }
    if (latestSkuId) handleUndoForSku(latestSkuId);
  }, [undoStacks, handleUndoForSku]);

  // ── Ctrl+Shift+Z keyboard shortcut (redoes last undone edit across all SKUs) ──
  const handleGlobalRedo = useCallback(() => {
    let latestEntry: UndoEntry | null = null;
    let latestSkuId = 0;
    for (const [skuId, stack] of Array.from(redoStacks)) {
      if (stack.length > 0) {
        const top = stack[stack.length - 1];
        if (!latestEntry) { latestEntry = top; latestSkuId = skuId; }
        else { latestEntry = top; latestSkuId = skuId; }
      }
    }
    if (latestSkuId) handleRedoForSku(latestSkuId);
  }, [redoStacks, handleRedoForSku]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Ctrl+Shift+Z = Redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleGlobalRedo();
        return;
      }
      // Ctrl+Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleGlobalUndo();
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleGlobalUndo, handleGlobalRedo]);

  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [oldValue, setOldValue] = useState("");
  const skipBlurRef = useRef(false);

  // ── Invoiced SHP dialog state ─────────────────────────────────────────────
  const [invoicedDialog, setInvoicedDialog] = useState<{
    open: boolean;
    skuId: number;
    periodId: number;
    skuName: string;
    periodLabel: string;
    nextPeriodLabel?: string;
    existingWeeks?: { week1: number; week2: number; week3: number; week4: number };
  } | null>(null);

  // ── Cell highlight state (for recommendation apply/rollback) ─────────────
  const [highlightedCells, setHighlightedCells] = useState<Set<string>>(new Set());

  const highlightCell = useCallback((skuId: number, periodId: number) => {
    const forecastKey = `${skuId}-${periodId}-Forecast`;
    const imsKey = `${skuId}-${periodId}-IMS`;
    setHighlightedCells(prev => {
      const next = new Set(prev);
      next.add(forecastKey);
      next.add(imsKey);
      return next;
    });
    setTimeout(() => {
      setHighlightedCells(prev => {
        const next = new Set(prev);
        next.delete(forecastKey);
        next.delete(imsKey);
        return next;
      });
    }, 2500);
  }, []);

  // ── Data maps ─────────────────────────────────────────────────────────────
  const planningMap = useMemo(() => {
    const map = new Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>();
    for (const d of data?.planningFg ?? []) {
      map.set(`${d.skuId}-${d.periodId}`, {
        openingStock: d.openingStock ?? "0",
        adjustments: d.adjustments ?? "0",
        invoiced: (d as any).invoiced ?? "0",
        arrivals: (d as any).arrivals ?? "0",
      });
    }
    return map;
  }, [data]);

  const shipmentMap = useMemo(() => {
    const map = new Map<string, { week1: number; week2: number; week3: number; week4: number }>();
    for (const d of data?.shipment ?? []) {
      map.set(`${d.skuId}-${d.periodId}`, {
        week1: parseFloat(d.week1 ?? "0") || 0,
        week2: parseFloat(d.week2 ?? "0") || 0,
        week3: parseFloat(d.week3 ?? "0") || 0,
        week4: parseFloat(d.week4 ?? "0") || 0,
      });
    }
    return map;
  }, [data]);

  const imsMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of data?.ims ?? []) map.set(`${d.skuId}-${d.periodId}`, d.value ?? "0");
    return map;
  }, [data]);

  const forecastMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of data?.forecast ?? []) map.set(`${d.skuId}-${d.periodId}`, d.value ?? "0");
    return map;
  }, [data]);

  const arrivalMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of data?.arrival ?? []) {
      const total = (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0)
        + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
      map.set(`${d.skuId}-${d.periodId}`, total);
    }
    return map;
  }, [data]);

  const allSkus = data?.skus ?? [];
  const skus = allSkus;

  // Group SKUs by category for collapse/expand
  const skusByCategory = useMemo(() => {
    const categories: { category: string; skus: typeof allSkus }[] = [];
    const coreSkus = allSkus.filter(s => s.category === 'Core');
    const npiSkus = allSkus.filter(s => s.category !== 'Core');
    if (coreSkus.length > 0) categories.push({ category: 'Core', skus: coreSkus });
    if (npiSkus.length > 0) categories.push({ category: 'NPI', skus: npiSkus });
    return categories;
  }, [allSkus]);
  const periods = useMemo(() => [...(data?.periods ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [data]);

  // ── Current month boundary ────────────────────────────────────────────────
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const isFuturePeriod = useCallback((p: { year: number; month: number }) => {
    return p.year > currentYear || (p.year === currentYear && p.month >= currentMonth);
  }, [currentYear, currentMonth]);

  const isStrictlyFuture = useCallback((p: { year: number; month: number }) => {
    return p.year > currentYear || (p.year === currentYear && p.month > currentMonth);
  }, [currentYear, currentMonth]);

  const isProductionEditable = useCallback((p: { year: number; month: number }) => {
    const targetYear = currentMonth + 4 > 12 ? currentYear + 1 : currentYear;
    const targetMonth = ((currentMonth + 4 - 1) % 12) + 1;
    if (p.year > targetYear) return true;
    if (p.year === targetYear && p.month >= targetMonth) return true;
    return false;
  }, [currentYear, currentMonth]);

  const getRawIms = useCallback((skuId: number, periodId: number): number => {
    return parseFloat(imsMap.get(`${skuId}-${periodId}`) ?? "0") || 0;
  }, [imsMap]);

  const getEffectiveIms = useCallback((skuId: number, periodId: number): number => {
    const imsVal = parseFloat(imsMap.get(`${skuId}-${periodId}`) ?? "0") || 0;
    if (imsVal !== 0) return imsVal;
    const period = periods.find(p => p.id === periodId);
    if (period && (period.year > currentYear || (period.year === currentYear && period.month > currentMonth))) {
      return parseFloat(forecastMap.get(`${skuId}-${periodId}`) ?? "0") || 0;
    }
    return 0;
  }, [imsMap, forecastMap, periods, currentYear, currentMonth]);

  const calculateSkuData = useCallback((skuId: number) => {
    const result = new Map<RowLabel, Map<string, number>>();
    for (const label of ROW_LABELS) result.set(label, new Map());

    let prevClosingStock = 0;

    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      const planData = planningMap.get(`${skuId}-${p.id}`);
      const ims = getEffectiveIms(skuId, p.id);
      const invoiced = parseFloat(planData?.invoiced ?? "0") || 0;
      const planningArrivals = parseFloat(planData?.arrivals ?? "0") || 0;
      const arrival = planningArrivals !== 0 ? planningArrivals : (arrivalMap.get(`${skuId}-${p.id}`) ?? 0);

      const openingStock = i === 0
        ? parseFloat(planData?.openingStock ?? "0") || 0
        : prevClosingStock;

      const adjustments = parseFloat(planData?.adjustments ?? "0") || 0;
      const closingStock = openingStock + adjustments + arrival - ims;

      let weeksOfStock = 0;
      if (closingStock !== 0) {
        const n1 = i + 1 < periods.length ? getEffectiveIms(skuId, periods[i + 1].id) : 0;
        const n2 = i + 2 < periods.length ? getEffectiveIms(skuId, periods[i + 2].id) : 0;
        const avg = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
        weeksOfStock = avg !== 0
          ? (closingStock / avg) * 4.3
          : closingStock > 0 ? Infinity : -Infinity;
      }

      result.get("Opening Stock")!.set(p.id.toString(), openingStock);
      result.get("Adjustments")!.set(p.id.toString(), adjustments);
      const rawIms = getRawIms(skuId, p.id);
      result.get("IMS")!.set(p.id.toString(), rawIms);
      result.get("Invoiced (SHP)")!.set(p.id.toString(), invoiced);
      result.get("Actual arrivals / Planned Orders")!.set(p.id.toString(), arrival);
      result.get("Closing Stock")!.set(p.id.toString(), closingStock);
      result.get("Closing Stock - Weeks")!.set(p.id.toString(), weeksOfStock);

      prevClosingStock = closingStock;
    }
    return result;
  }, [periods, planningMap, arrivalMap, getEffectiveIms, getRawIms]);

  const isCellEditable = useCallback((label: RowLabel, p: { year: number; month: number }, periodIndex: number): boolean => {
    if (label === "Closing Stock" || label === "Closing Stock - Weeks") return false;
    if (label === "Invoiced (SHP)") return isFuturePeriod(p);
    if (label === "Opening Stock") return periodIndex === 0;
    if (label === "Adjustments") return true;
    if (label === "IMS") return isFuturePeriod(p);
    if (label === "Actual arrivals / Planned Orders") return isFuturePeriod(p);
    return false;
  }, [isFuturePeriod]);

  // ── Cell interaction ──────────────────────────────────────────────────────
  const handleCellClick = (cellKey: string, currentValue: number, label: RowLabel, p: { id: number; year: number; month: number; label: string }, periodIndex: number, skuId?: number) => {
    if (!isCellEditable(label, p, periodIndex)) return;
    if (label === "Invoiced (SHP)" && skuId !== undefined) {
      const periodIdx = periods.findIndex(pp => pp.id === p.id);
      const nextPeriod = periodIdx >= 0 && periodIdx < periods.length - 1 ? periods[periodIdx + 1] : undefined;
      const sku = data?.skus.find(s => s.id === skuId);
      setInvoicedDialog({
        open: true,
        skuId,
        periodId: p.id,
        skuName: sku?.name ?? "",
        periodLabel: p.label,
        nextPeriodLabel: nextPeriod?.label,
        existingWeeks: shipmentMap.get(`${skuId}-${p.id}`),
      });
      return;
    }
    setEditingCell(cellKey);
    setOldValue(currentValue.toString());
    setEditValue(currentValue === 0 ? "" : currentValue.toString());
  };

  const handleCellSave = (skuId: number, periodId: number, label: RowLabel) => {
    let numVal = parseFloat(editValue) || 0;
    if (label === "IMS" || label === "Opening Stock" || label === "Adjustments" || label === "Actual arrivals / Planned Orders") {
      numVal = Math.max(0, numVal);
    }
    const oldNum = parseFloat(oldValue) || 0;
    if (numVal === oldNum) { setEditingCell(null); return; }

    const sku = data?.skus.find(s => s.id === skuId);
    const period = data?.periods.find(p => p.id === periodId);

    if (label === "IMS") {
      const isFuture = period ? isStrictlyFuture(period) : false;
      if (isFuture) {
        pushUndo({ type: "syncIms", skuId, periodId, label: "IMS", oldValue: oldNum.toString(), newValue: numVal.toString(), skuName: sku?.name ?? "", periodLabel: period?.label ?? "" });
        syncIms.mutate({ skuId, periodId, value: numVal.toString(), username: appUser?.displayName, skuName: sku?.name, periodLabel: period?.label, oldValue, source: `Planning FG ${weight}` });
      } else {
        pushUndo({ type: "imsDirect", skuId, periodId, label: "IMS", oldValue: oldNum.toString(), newValue: numVal.toString(), skuName: sku?.name ?? "", periodLabel: period?.label ?? "" });
        updateImsDirect.mutate({ skuId, periodId, value: numVal.toString(), isActual: true, username: appUser?.displayName, skuName: sku?.name, periodLabel: period?.label, oldValue });
      }
      setEditingCell(null);
      return;
    }

    if (label === "Actual arrivals / Planned Orders") {
      pushUndo({ type: "syncArrival", skuId, periodId, label, oldValue: oldNum.toString(), newValue: numVal.toString(), skuName: sku?.name ?? "", periodLabel: period?.label ?? "" });
      syncArrival.mutate({ skuId, periodId, value: numVal.toString(), username: appUser?.displayName, skuName: sku?.name, periodLabel: period?.label, oldValue });
      setEditingCell(null);
      return;
    }

    // Push undo entry for planningFgCell edits (Opening Stock, Adjustments)
    pushUndo({
      type: "planningFgCell",
      skuId, periodId,
      label,
      oldValue: oldNum.toString(),
      newValue: numVal.toString(),
      skuName: sku?.name ?? "",
      periodLabel: period?.label ?? "",
    });

    const updateData: any = { skuId, periodId };
    if (label === "Opening Stock")  updateData.openingStock = numVal.toString();
    else if (label === "Adjustments") updateData.adjustments = numVal.toString();
    updateData.username = appUser?.displayName;
    updateData.skuName = sku?.name;
    updateData.periodLabel = period?.label;
    updateData.oldValue = oldValue;
    updateCell.mutate(updateData);
    setEditingCell(null);
  };

  // handleCellKeyDown defined after periodsByYear below

  const formatNumber = (val: number, isWeeks = false) => {
    if (isWeeks) {
      if (!isFinite(val)) return val > 0 ? "∞" : "-∞";
      if (val === 0) return "0.0";
      return val.toFixed(1);
    }
    if (val === 0) return "-";
    return val.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };

  // ── Year/period grouping ──────────────────────────────────────────────────
  const years = useMemo(() => Array.from(new Set(periods.map(p => p.year))).sort(), [periods]);
  const periodsByYear = useMemo(() => years.map(year => ({
    year,
    periods: periods.filter(p => p.year === year),
  })), [years, periods]);

  // Editable row labels (excluding computed rows)
  const EDITABLE_LABELS: RowLabel[] = [
    "Opening Stock",
    "Adjustments",
    "IMS",
    "Actual arrivals / Planned Orders",
  ];

  // Build flat navigable cell IDs: skuId-periodId-label (only editable cells)
  const navigableCellIds = useMemo(() => {
    const visiblePeriods = periodsByYear
      .filter(({ year }) => !collapsedYears.has(year))
      .flatMap(({ periods: yp }) => yp);
    const ids: string[] = [];
    for (const cat of skusByCategory) {
      if (collapsedCategories.has(cat.category)) continue;
      for (const sku of cat.skus) {
        // Forecast row (editable for future periods)
        for (const p of visiblePeriods) {
          const idx = periods.findIndex(pp => pp.id === p.id);
          if (isCellEditable("IMS", p, idx)) ids.push(`${sku.id}-${p.id}-IMS`);
        }
        // Other editable rows
        for (const label of EDITABLE_LABELS) {
          if (label === "IMS") continue; // already added above
          for (const p of visiblePeriods) {
            const idx = periods.findIndex(pp => pp.id === p.id);
            if (isCellEditable(label, p, idx)) ids.push(`${sku.id}-${p.id}-${label}`);
          }
        }
      }
    }
    return ids;
  }, [skusByCategory, periodsByYear, collapsedYears, collapsedCategories, periods, isCellEditable]);

  const visiblePeriodCount = useMemo(() =>
    periodsByYear.filter(({ year }) => !collapsedYears.has(year)).flatMap(({ periods: yp }) => yp).length,
    [periodsByYear, collapsedYears]
  );

  const { handleNavKeyDown } = useGridNav({
    cellIds: navigableCellIds,
    editingCell,
    setEditingCell: (id) => {
      if (id === null) { setEditingCell(null); return; }
      // Parse cellId: skuId-periodId-label (label may contain spaces/hyphens)
      const firstDash = id.indexOf("-");
      const secondDash = id.indexOf("-", firstDash + 1);
      const skuId = parseInt(id.slice(0, firstDash));
      const periodId = parseInt(id.slice(firstDash + 1, secondDash));
      const label = id.slice(secondDash + 1) as RowLabel;
      // Get current value for the cell
      const skuData = calculateSkuData(skuId);
      const val = skuData.get(label)?.get(periodId.toString()) ?? 0;
      setEditingCell(id);
      setOldValue(val.toString());
      setEditValue(val === 0 ? "" : val.toString());
    },
    onSave: (cellId) => {
      const firstDash = cellId.indexOf("-");
      const secondDash = cellId.indexOf("-", firstDash + 1);
      const skuId = parseInt(cellId.slice(0, firstDash));
      const periodId = parseInt(cellId.slice(firstDash + 1, secondDash));
      const label = cellId.slice(secondDash + 1) as RowLabel;
      handleCellSave(skuId, periodId, label);
      skipBlurRef.current = true;
    },
    onCancel: () => setEditingCell(null),
    colCount: visiblePeriodCount,
  });

  const handleCellKeyDown = (e: React.KeyboardEvent, skuId: number, periodId: number, label: RowLabel) => {
    handleNavKeyDown(e, `${skuId}-${periodId}-${label}`);
  };

  // ── Row styling ───────────────────────────────────────────────────────────
  const getRowBg = (label: RowLabel) => {
    if (label === "IMS") return "bg-amber-50";
    if (label === "Invoiced (SHP)") return "bg-emerald-50";
    if (label === "Actual arrivals / Planned Orders") return "bg-sky-50";
    if (label === "Closing Stock") return "bg-slate-50";
    if (label === "Closing Stock - Weeks") return "bg-slate-100";
    return "";
  };

  const getLabelBg = (label: RowLabel) => {
    const bg = getRowBg(label);
    return bg || "bg-white";
  };

  const getRowLabel = (label: RowLabel) => {
    if (label === "Opening Stock") return <>{label}<span className="ml-1 text-[9px] text-muted-foreground">(1st month)</span></>;
    if (label === "Adjustments") return <>{label}<span className="ml-1 text-[9px] text-blue-500">✎ all months</span></>;
    if (label === "IMS") return <>{label}<span className="ml-1 text-[9px] text-blue-500">✎ current & future → syncs IMS source</span></>;
    if (label === "Invoiced (SHP)") return <>{label}<span className="ml-1 text-[9px] text-blue-500">✎ future (weekly)</span></>;
    if (label === "Actual arrivals / Planned Orders") return <>{label}<span className="ml-1 text-[9px] text-blue-500">✎ current & future → syncs Production</span></>;
    if (label === "Closing Stock") return <>{label}<span className="ml-1 text-[9px] text-muted-foreground">auto</span></>;
    if (label === "Closing Stock - Weeks") return <>{label}<span className="ml-1 text-[9px] text-muted-foreground">auto</span></>;
    return label;
  };

  // ── Forecast row save with undo tracking ──────────────────────────────────
  const handleForecastSave = (skuId: number, periodId: number) => {
    const numVal = Math.max(0, parseFloat(editValue) || 0);
    const oldNum = parseFloat(oldValue) || 0;
    if (numVal === oldNum) { setEditingCell(null); return; }

    const sku = data?.skus.find(s => s.id === skuId);
    const period = data?.periods.find(pp => pp.id === periodId);

    // Push undo entry
    pushUndo({
      type: "syncIms",
      skuId, periodId,
      label: "Forecast",
      oldValue: oldNum.toString(),
      newValue: numVal.toString(),
      skuName: sku?.name ?? "",
      periodLabel: period?.label ?? "",
    });

    syncIms.mutate({
      skuId, periodId,
      value: numVal.toString(),
      username: appUser?.displayName,
      skuName: sku?.name,
      periodLabel: period?.label,
      oldValue,
      source: `Planning FG ${weight} (Forecast edit)`,
    });
    setEditingCell(null);
  };

  if (isLoading) return <TableSkeleton title={`Planning FG ${weight}`} rows={12} cols={8} />;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Planning FG {weight}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Finished goods planning for {weight} products. Closing Stock and Weeks are computed automatically.
            </p>
          </div>
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
        </div>

        {/* Formula reference */}
        <div className="mt-2 p-2 rounded bg-muted text-[10px] text-muted-foreground space-y-0.5">
          <p><strong>Closing Stock</strong> = Opening Stock + Adjustments + Arrivals − IMS</p>
          <p><strong>Weeks of Stock</strong> = (Closing Stock ÷ AVG(next 2 months effective IMS)) × 4.3</p>
        </div>

        {/* Healthy stock level legend */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold">
          <span className="text-muted-foreground mr-1">Healthy stock range:</span>
          <span className="px-2 py-0.5 rounded bg-gray-900 text-white">Negative / Critical (&lt; 0w)</span>
          <span className="px-2 py-0.5 rounded bg-gray-200 text-gray-600">Zero stock (0w)</span>
          <span className="px-2 py-0.5 rounded bg-red-600 text-white">Low (&lt; 4w)</span>
          <span className="px-2 py-0.5 rounded border border-emerald-600 text-emerald-700">Healthy (4–6w) ✓</span>
          <span className="px-2 py-0.5 rounded bg-red-600 text-white">High (&gt; 6w)</span>
        </div>


      </div>

      {skusByCategory.map(group => (
        <div key={group.category} className="space-y-3">
          {/* Category collapse/expand header */}
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-lg cursor-pointer select-none hover:brightness-95 transition-all font-bold text-xs tracking-wider uppercase ${
              group.category === 'Core' ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700'
            }`}
            onClick={() => toggleCategory(group.category)}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsedCategories.has(group.category) ? '' : 'rotate-90'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {group.category}
            <span className="font-normal normal-case text-[10px] text-muted-foreground">
              ({group.skus.length} SKUs){collapsedCategories.has(group.category) ? ' \u2014 collapsed' : ''}
            </span>
          </div>

          {!collapsedCategories.has(group.category) && group.skus.map((sku, skuIdx) => {
        const skuData = calculateSkuData(sku.id);
        const isOddSku = skuIdx % 2 === 1;
        return (
          <Card key={sku.id} className={`overflow-hidden ${isOddSku ? 'bg-slate-50/50' : ''}`}>
            <CardHeader className={`pb-2 ${isOddSku ? 'bg-gradient-to-r from-primary/10 to-slate-50/50' : 'bg-gradient-to-r from-primary/5 to-transparent'}`}>
              <CardTitle className="text-sm font-semibold flex items-center gap-2 relative flex-wrap">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                  weight === "50g" ? "bg-blue-100 text-blue-700" :
                  weight === "250g" ? "bg-amber-100 text-amber-700" :
                  "bg-rose-100 text-rose-700"
                }`}>{weight}</span>
                {sku.name}
                {(sku as any).packagingType && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                    ((sku as any).packagingType ?? 'New') === 'New' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                  }`}>{(sku as any).packagingType === 'Old' ? 'Old Pkg' : 'New Pkg'}</span>
                )}
                {sku.category && (
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                    sku.category === "Core" ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"
                  }`}>{sku.category}</span>
                )}
                <SkuRecommendations
                  skuId={sku.id}
                  skuName={sku.name}
                  weight={weight}
                  periods={periods}
                  imsMap={imsMap}
                  forecastMap={forecastMap}
                  calculateSkuData={calculateSkuData}
                  onApplied={highlightCell}
                  onRolledBack={highlightCell}
                />
                <BestStrategy
                  skuId={sku.id}
                  skuName={sku.name}
                  weight={weight}
                  periods={periods}
                  imsMap={imsMap}
                  forecastMap={forecastMap}
                  calculateSkuData={calculateSkuData}
                  onApplied={highlightCell}
                />
                {/* Per-SKU Undo + Redo buttons */}
                {(() => {
                  const skuUndoStack = getSkuUndoStack(sku.id);
                  const skuRedoStack = getSkuRedoStack(sku.id);
                  if (skuUndoStack.length === 0 && skuRedoStack.length === 0) return null;

                  const lastUndo = skuUndoStack.length > 0 ? skuUndoStack[skuUndoStack.length - 1] : null;
                  const lastRedo = skuRedoStack.length > 0 ? skuRedoStack[skuRedoStack.length - 1] : null;

                  return (
                    <div className="ml-auto flex items-center gap-1">
                      {/* Undo button */}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isUndoing || isRedoing || skuUndoStack.length === 0}
                        onClick={(e) => { e.stopPropagation(); handleUndoForSku(sku.id); }}
                        className="flex items-center gap-1 text-[10px] h-6 px-2 border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 disabled:opacity-40"
                        title={lastUndo ? `Undo: ${lastUndo.label} (${lastUndo.periodLabel}): ${lastUndo.newValue || "0"} → ${lastUndo.oldValue || "0"} (Ctrl+Z)` : "Nothing to undo"}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M7.793 2.232a.75.75 0 0 1-.025 1.06L3.622 7.25h10.003a5.375 5.375 0 0 1 0 10.75H10.75a.75.75 0 0 1 0-1.5h2.875a3.875 3.875 0 0 0 0-7.75H3.622l4.146 3.957a.75.75 0 0 1-1.036 1.085l-5.5-5.25a.75.75 0 0 1 0-1.085l5.5-5.25a.75.75 0 0 1 1.06.025Z" clipRule="evenodd" />
                        </svg>
                        {isUndoing ? "Undoing..." : lastUndo ? (
                          <span>
                            Undo {lastUndo.label} ({lastUndo.periodLabel}):{" "}
                            <span className="font-bold">{lastUndo.newValue || "0"}</span>
                            {" → "}
                            <span className="font-bold">{lastUndo.oldValue || "0"}</span>
                            {skuUndoStack.length > 1 && <span className="ml-1 opacity-70">+{skuUndoStack.length - 1} more</span>}
                          </span>
                        ) : "Undo"}
                      </Button>

                      {/* Redo button */}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isUndoing || isRedoing || skuRedoStack.length === 0}
                        onClick={(e) => { e.stopPropagation(); handleRedoForSku(sku.id); }}
                        className="flex items-center gap-1 text-[10px] h-6 px-2 border-blue-300 bg-blue-50 hover:bg-blue-100 text-blue-800 disabled:opacity-40"
                        title={lastRedo ? `Redo: ${lastRedo.label} (${lastRedo.periodLabel}): ${lastRedo.oldValue || "0"} → ${lastRedo.newValue || "0"} (Ctrl+Shift+Z)` : "Nothing to redo"}
                      >
                        {isRedoing ? "Redoing..." : lastRedo ? (
                          <span>
                            Redo {lastRedo.label} ({lastRedo.periodLabel}):{" "}
                            <span className="font-bold">{lastRedo.oldValue || "0"}</span>
                            {" → "}
                            <span className="font-bold">{lastRedo.newValue || "0"}</span>
                            {skuRedoStack.length > 1 && <span className="ml-1 opacity-70">+{skuRedoStack.length - 1} more</span>}
                          </span>
                        ) : "Redo"}
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M12.207 2.232a.75.75 0 0 0 .025 1.06l4.146 3.958H6.375a5.375 5.375 0 0 0 0 10.75H9.25a.75.75 0 0 0 0-1.5H6.375a3.875 3.875 0 0 1 0-7.75h10.003l-4.146 3.957a.75.75 0 0 0 1.036 1.085l5.5-5.25a.75.75 0 0 0 0-1.085l-5.5-5.25a.75.75 0 0 0-1.06.025Z" clipRule="evenodd" />
                        </svg>
                      </Button>
                    </div>
                  );
                })()}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[9px] font-semibold">
                <span className="text-muted-foreground">Stock health:</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-900 text-white">Critical (&lt;0w)</span>
                <span className="px-1.5 py-0.5 rounded bg-gray-200 text-gray-600">Zero (0w)</span>
                <span className="px-1.5 py-0.5 rounded bg-red-600 text-white">Low (&lt;4w)</span>
                <span className="px-1.5 py-0.5 rounded border border-emerald-600 text-emerald-700">Healthy 4–6w ✓</span>
                <span className="px-1.5 py-0.5 rounded bg-red-600 text-white">High (&gt;6w)</span>
              </div>
            </CardHeader>

            <CardContent className="p-0">
              <div className="overflow-auto max-h-[70vh]">
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr className="bg-muted">
                      <th className="sticky left-0 bg-muted z-30 px-3 py-1.5 text-left font-medium text-muted-foreground min-w-[220px]">
                        Metric
                      </th>
                      {periodsByYear.map(({ year, periods: yPeriods }) => {
                        const isCollapsed = collapsedYears.has(year);
                        return (
                          <th key={`yh-${year}`} colSpan={isCollapsed ? 1 : yPeriods.length + 1}
                            className="px-1 py-1 text-center font-bold border-l border-border text-primary cursor-pointer select-none hover:bg-primary/20 transition-colors"
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
                    <tr className="bg-muted border-b">
                      <th className="sticky left-0 bg-muted z-30 px-3 py-1"></th>
                      {periodsByYear.map(({ year, periods: yPeriods }) => {
                        const isCollapsed = collapsedYears.has(year);
                        return (
                        <Fragment key={`sub-${year}`}>
                          {!isCollapsed && yPeriods.map(p => (
                            <th key={p.id} className="px-1 py-1 text-center text-muted-foreground min-w-[60px] text-[10px]">
                              {p.label.split(" ")[0]}
                            </th>
                          ))}
                          <th className="px-1 py-1 text-center font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-800 min-w-[70px] text-[10px]">
                            {isCollapsed ? year : "Total"}
                          </th>
                        </Fragment>
                        );
                      })}
                    </tr>
                  </thead>

                  <tbody>
                    {/* Forecast row — editable for future months */}
                    <tr className="border-b bg-blue-50">
                      <td className="sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap bg-blue-50 text-blue-800">
                        Forecast
                        <span className="ml-1 text-[9px] text-blue-500">✎ current + future months</span>
                      </td>
                      {periodsByYear.map(({ year, periods: yPeriods }) => {
                        let yearTotal = 0;
                        const isYearCollapsed = collapsedYears.has(year);
                        return (
                          <Fragment key={`forecast-y-${year}`}>
                            {!isYearCollapsed && yPeriods.map(p => {
                              const val = parseFloat(forecastMap.get(`${sku.id}-${p.id}`) ?? "0") || 0;
                              yearTotal += val;
                              const cellKey = `${sku.id}-${p.id}-Forecast`;
                              const isEditing = editingCell === cellKey;
                              const editable = isFuturePeriod(p);
                              const isPast = !isFuturePeriod(p);

                              if (isEditing) {
                                return (
                                  <td key={cellKey} className="px-0.5 py-0.5">
                                    <input
                                      type="number"
                                      min="0"
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } handleForecastSave(sku.id, p.id); }}
                                      onKeyDown={e => {
                                        if (e.key === "Enter") { handleForecastSave(sku.id, p.id); skipBlurRef.current = true; }
                                        else if (e.key === "Escape") setEditingCell(null);
                                      }}
                                      autoFocus
                                      className="w-full px-1 py-0.5 text-right text-xs border border-blue-400 rounded bg-blue-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                    />
                                  </td>
                                );
                              }

                              const isForecastHighlighted = highlightedCells.has(`${sku.id}-${p.id}-Forecast`);
                              return (
                                <td
                                  key={cellKey}
                                  className={`px-1 py-1.5 text-right tabular-nums text-blue-700 font-medium transition-colors ${
                                    isForecastHighlighted ? "cell-flash" : ""
                                  } ${
                                    isPast ? "bg-slate-50" : ""
                                  } ${
                                    editable ? "cursor-pointer hover:bg-blue-100 ring-inset hover:ring-1 hover:ring-blue-300" : "cursor-not-allowed"
                                  }`}
                                  onClick={() => {
                                    if (!editable) return;
                                    setEditingCell(cellKey);
                                    setOldValue(val.toString());
                                    setEditValue(val === 0 ? "" : val.toString());
                                  }}
                                  title={isPast ? "Past month — read only" : editable ? "Click to edit Forecast" : undefined}
                                >
                                  <span className="inline-flex items-center justify-end gap-0.5 w-full">
                                    {isPast && (
                                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"
                                        className="w-2.5 h-2.5 text-slate-400 flex-shrink-0" aria-label="Locked">
                                        <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V6H4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-.5V4.5A3.5 3.5 0 0 0 8 1Zm2 5V4.5a2 2 0 1 0-4 0V6h4Z" clipRule="evenodd" />
                                      </svg>
                                    )}
                                    <span>{val !== 0 ? val.toLocaleString() : "-"}</span>
                                  </span>
                                </td>
                              );
                            })}
                            <td className="px-1 py-1.5 text-right tabular-nums font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-900">
                              {yearTotal !== 0 ? yearTotal.toLocaleString() : "-"}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>

                    {/* Data rows */}
                    {ROW_LABELS.map(label => {
                      const rowData = skuData.get(label)!;
                      const isWeeks = label === "Closing Stock - Weeks";
                      const isClosingStock = label === "Closing Stock";
                      const isOpeningStock = label === "Opening Stock";
                      const rowBg = getRowBg(label);
                      let globalPeriodIdx = 0;

                      return (
                        <tr key={label} className={`border-b ${rowBg}`}>
                          <td className={`sticky left-0 z-10 px-3 py-1.5 font-medium whitespace-nowrap ${getLabelBg(label)} ${isClosingStock || isWeeks ? "font-bold" : ""}`}>
                            {getRowLabel(label)}
                          </td>

                          {periodsByYear.map(({ year, periods: yPeriods }) => {
                            let yearTotal = 0;
                            const isYrCollapsed = collapsedYears.has(year);
                            return (
                              <Fragment key={`${label}-y-${year}`}>
                                {!isYrCollapsed && yPeriods.map(p => {
                                  const idx = globalPeriodIdx++;
                                  const val = rowData.get(p.id.toString()) ?? 0;
                                  if (!isWeeks && !isOpeningStock) yearTotal += val;

                                  const cellKey = `${sku.id}-${p.id}-${label}`;
                                  const isEditing = editingCell === cellKey;
                                  const editable = isCellEditable(label, p, idx);

                                  let cellClass = "";
                                  if (isWeeks) cellClass = getWeeksStyle(val);
                                  else if (isClosingStock) cellClass = getClosingStockStyle(val);

                                  const isPast = !isFuturePeriod(p);
                                  const dimClass = "";

                                  const highlightKey = label === "IMS" ? `${sku.id}-${p.id}-IMS` : "";
                                  const isCellHighlighted = highlightKey ? highlightedCells.has(highlightKey) : false;

                                  if (isEditing) {
                                    return (
                                      <td key={cellKey} className="px-0.5 py-0.5">
                                        <input
                                          type="number"
                                          value={editValue}
                                          onChange={e => setEditValue(e.target.value)}
                                          onBlur={() => { if (skipBlurRef.current) { skipBlurRef.current = false; return; } handleCellSave(sku.id, p.id, label); }}
                                          onKeyDown={e => handleCellKeyDown(e, sku.id, p.id, label)}
                                          autoFocus
                                          className="w-full px-1 py-0.5 text-right text-xs border border-primary rounded bg-primary/5 focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                      </td>
                                    );
                                  }

                                  return (
                                    <td
                                      key={cellKey}
                                      className={`px-1 py-1.5 text-right tabular-nums ${cellClass} ${dimClass} ${isCellHighlighted ? "cell-flash" : ""} ${
                                        editable ? "cursor-pointer hover:bg-primary/10 transition-colors ring-inset hover:ring-1 hover:ring-primary/30" : ""
                                      }`}
                                      onClick={() => editable && handleCellClick(cellKey, val, label, p, idx, sku.id)}
                                      title={editable ? `Click to edit ${label}` : undefined}
                                    >
                                      {formatNumber(val, isWeeks)}
                                    </td>
                                  );
                                })}
                                <td className="px-1 py-1.5 text-right tabular-nums font-bold border-l-2 border-amber-400 bg-amber-50 text-amber-900">
                                  {isWeeks || isOpeningStock ? "-" : formatNumber(yearTotal)}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
        </div>
      ))}

      {/* Invoiced SHP Week Picker Dialog */}
      {invoicedDialog && (
        <InvoicedSHPDialog
          open={invoicedDialog.open}
          onClose={() => setInvoicedDialog(null)}
          skuId={invoicedDialog.skuId}
          periodId={invoicedDialog.periodId}
          skuName={invoicedDialog.skuName}
          periodLabel={invoicedDialog.periodLabel}
          nextPeriodLabel={invoicedDialog.nextPeriodLabel}
          existingWeeks={invoicedDialog.existingWeeks}
          onSaved={() => utils.data.planningFg.invalidate()}
        />
      )}

      {skus.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No {weight} SKUs found. Add SKUs via the SKU Management page or upload an Excel workbook.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
