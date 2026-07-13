import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ── Zone definitions (shared with SmartRecommendations) ──────────────────────
type Zone = "green" | "red_under" | "red_over" | "black" | "grey" | "infinity";

function classifyZone(weeks: number): Zone {
  if (!isFinite(weeks)) return weeks > 0 ? "infinity" : "black";
  if (weeks === 0) return "grey";
  if (weeks < 0) return "black";
  if (weeks < 4) return "red_under";
  if (weeks >= 4 && weeks <= 6) return "green";
  return "red_over";
}

const ZONE_BADGE: Record<Zone, { label: string; cls: string }> = {
  green:     { label: "OK",       cls: "bg-emerald-100 text-emerald-700" },
  red_under: { label: "Low",      cls: "bg-red-100 text-red-700" },
  red_over:  { label: "High",     cls: "bg-red-100 text-red-700" },
  black:     { label: "Critical", cls: "bg-gray-900 text-white" },
  grey:      { label: "No Stock", cls: "bg-gray-200 text-gray-600" },
  infinity:  { label: "∞",        cls: "bg-purple-100 text-purple-700" },
};

function weeksStyle(weeks: number): string {
  if (!isFinite(weeks)) return weeks > 0 ? "text-purple-700" : "text-white bg-gray-900";
  if (weeks === 0) return "text-gray-500 bg-gray-100";
  if (weeks < 0) return "text-white bg-gray-900";
  if (weeks < 4) return "text-white bg-red-500";
  if (weeks <= 6) return "text-emerald-700 font-bold";
  return "text-white bg-red-500";
}

const TARGET_WEEKS = 4.0;

// ── Types ────────────────────────────────────────────────────────────────────
interface StrategyAction {
  periodId: number;
  periodLabel: string;
  type: "forecast" | "invoiced" | "both";
  // Forecast
  currentForecast: number;
  newForecast: number;
  forecastDelta: number;
  // Invoiced
  currentInvoiced: number;
  newInvoiced: number;
  invoicedDelta: number;
  // Impact
  beforeWeeks: number;
  afterWeeks: number;
  beforeZone: Zone;
  afterZone: Zone;
  beforeClosing: number;
  afterClosing: number;
}

interface StrategyResult {
  actions: StrategyAction[];
  periodsImproved: number;
  periodsToHealthy: number;
  totalForecastChange: number;
  totalInvoicedChange: number;
}

export interface BestStrategyProps {
  skuId: number;
  skuName: string;
  weight: string;
  periods: Array<{ id: number; label: string; year: number; month: number; sortOrder: number }>;
  imsMap: Map<string, string>;
  forecastMap: Map<string, string>;
  calculateSkuData: (skuId: number) => Map<string, Map<string, number>>;
  onApplied?: (skuId: number, periodId: number) => void;
}

// ── Combined simulation engine ───────────────────────────────────────────────
// Runs the full Planning FG calculation with multiple patches applied simultaneously
function runCombinedSimulation(
  skuId: number,
  periods: BestStrategyProps["periods"],
  imsMap: Map<string, string>,
  forecastMap: Map<string, string>,
  planningMap: Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>,
  patches: Array<{
    forecastPeriodId?: number;
    newForecast?: number;
    invoicedPeriodId?: number;
    newInvoiced?: number;
  }>,
  currentYear: number,
  currentMonth: number,
): Map<string, { closing: number; weeks: number; forecast: number; invoiced: number; arrivals: number }> {
  const sorted = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);

  // Apply all forecast patches
  const patchedForecastMap = new Map(forecastMap);
  for (const patch of patches) {
    if (patch.forecastPeriodId !== undefined && patch.newForecast !== undefined) {
      patchedForecastMap.set(`${skuId}-${patch.forecastPeriodId}`, patch.newForecast.toString());
    }
  }

  // Apply all invoiced/arrival patches
  const patchedPlanningMap = new Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>();
  planningMap.forEach((v, k) => patchedPlanningMap.set(k, { ...v }));

  for (const patch of patches) {
    if (patch.invoicedPeriodId !== undefined && patch.newInvoiced !== undefined) {
      const key = `${skuId}-${patch.invoicedPeriodId}`;
      const existing = patchedPlanningMap.get(key);
      if (existing) {
        const oldInvoiced = parseFloat(existing.invoiced) || 0;
        const delta = patch.newInvoiced - oldInvoiced;
        patchedPlanningMap.set(key, { ...existing, invoiced: patch.newInvoiced.toString() });

        const sameMonthArrivalDelta = Math.round(delta / 2);
        const nextMonthArrivalDelta = delta - sameMonthArrivalDelta;

        const oldArrivals = parseFloat(patchedPlanningMap.get(key)!.arrivals) || 0;
        patchedPlanningMap.set(key, {
          ...patchedPlanningMap.get(key)!,
          arrivals: (oldArrivals + sameMonthArrivalDelta).toString(),
        });

        const prodIdx = sorted.findIndex(p => p.id === patch.invoicedPeriodId);
        if (prodIdx >= 0 && prodIdx + 1 < sorted.length) {
          const nextPeriod = sorted[prodIdx + 1];
          const nextKey = `${skuId}-${nextPeriod.id}`;
          const nextExisting = patchedPlanningMap.get(nextKey);
          if (nextExisting) {
            const nextOldArrivals = parseFloat(nextExisting.arrivals) || 0;
            patchedPlanningMap.set(nextKey, {
              ...nextExisting,
              arrivals: (nextOldArrivals + nextMonthArrivalDelta).toString(),
            });
          }
        }
      }
    }
  }

  const getEffIms = (fMap: Map<string, string>, pid: number): number => {
    const imsVal = parseFloat(imsMap.get(`${skuId}-${pid}`) ?? "0") || 0;
    if (imsVal !== 0) return imsVal;
    const period = sorted.find(p => p.id === pid);
    if (period && (period.year > currentYear || (period.year === currentYear && period.month > currentMonth))) {
      return parseFloat(fMap.get(`${skuId}-${pid}`) ?? "0") || 0;
    }
    return 0;
  };

  const result = new Map<string, { closing: number; weeks: number; forecast: number; invoiced: number; arrivals: number }>();
  let prevClosing = 0;
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const planData = patchedPlanningMap.get(`${skuId}-${p.id}`);
    const ims = getEffIms(patchedForecastMap, p.id);
    const arrival = parseFloat(planData?.arrivals ?? "0") || 0;
    const adjustments = parseFloat(planData?.adjustments ?? "0") || 0;
    const invoiced = parseFloat(planData?.invoiced ?? "0") || 0;
    const openingStock = i === 0 ? (parseFloat(planData?.openingStock ?? "0") || 0) : prevClosing;
    const closing = openingStock + adjustments + arrival - ims;
    const forecast = parseFloat(patchedForecastMap.get(`${skuId}-${p.id}`) ?? "0") || 0;

    let weeks = 0;
    if (closing !== 0) {
      const n1 = i + 1 < sorted.length ? getEffIms(patchedForecastMap, sorted[i + 1].id) : 0;
      const n2 = i + 2 < sorted.length ? getEffIms(patchedForecastMap, sorted[i + 2].id) : 0;
      const avg = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
      weeks = avg !== 0 ? (closing / avg) * 4.3 : closing > 0 ? Infinity : -Infinity;
    }
    result.set(p.id.toString(), { closing, weeks, forecast, invoiced, arrivals: arrival });
    prevClosing = closing;
  }
  return result;
}

// ── Best Strategy computation ────────────────────────────────────────────────
function computeBestStrategy(
  skuId: number,
  periods: BestStrategyProps["periods"],
  imsMap: Map<string, string>,
  forecastMap: Map<string, string>,
  planningMap: Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>,
  currentYear: number,
  currentMonth: number,
): StrategyResult {
  const sorted = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);

  // First, compute baseline (before) data
  const beforeData = runCombinedSimulation(skuId, periods, imsMap, forecastMap, planningMap, [], currentYear, currentMonth);

  // Identify all unhealthy future periods
  const unhealthyPeriods: Array<{
    index: number;
    period: typeof sorted[0];
    weeks: number;
    zone: Zone;
    closingStock: number;
    avgNextIms: number;
    currentForecast: number;
    currentInvoiced: number;
  }> = [];

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    if (p.year < currentYear || (p.year === currentYear && p.month <= currentMonth)) continue;

    const data = beforeData.get(p.id.toString());
    if (!data) continue;

    const zone = classifyZone(data.weeks);
    if (zone === "green") continue;

    // Compute avgNextIms for this period
    const getEffIms = (pid: number): number => {
      const imsVal = parseFloat(imsMap.get(`${skuId}-${pid}`) ?? "0") || 0;
      if (imsVal !== 0) return imsVal;
      const period = sorted.find(pp => pp.id === pid);
      if (period && (period.year > currentYear || (period.year === currentYear && period.month > currentMonth))) {
        return parseFloat(forecastMap.get(`${skuId}-${pid}`) ?? "0") || 0;
      }
      return 0;
    };

    const n1 = i + 1 < sorted.length ? getEffIms(sorted[i + 1].id) : 0;
    const n2 = i + 2 < sorted.length ? getEffIms(sorted[i + 2].id) : 0;
    const avgNextIms = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;

    unhealthyPeriods.push({
      index: i,
      period: p,
      weeks: data.weeks,
      zone,
      closingStock: data.closing,
      avgNextIms,
      currentForecast: data.forecast,
      currentInvoiced: data.invoiced,
    });
  }

  // For each unhealthy period, compute the optimal action
  const actions: StrategyAction[] = [];
  const allPatches: Array<{
    forecastPeriodId?: number;
    newForecast?: number;
    invoicedPeriodId?: number;
    newInvoiced?: number;
  }> = [];

  for (const up of unhealthyPeriods) {
    const targetClosing = up.avgNextIms > 0 ? (TARGET_WEEKS * up.avgNextIms) / 4.3 : 0;
    const deficit = targetClosing - up.closingStock;

    let forecastDelta = 0;
    let newForecast = up.currentForecast;
    let invoicedDelta = 0;
    let newInvoiced = up.currentInvoiced;

    if (up.zone === "red_over") {
      // Overstocked: increase forecast (consumption) to bring weeks down
      const neededReduction = Math.abs(deficit);
      forecastDelta = Math.ceil(neededReduction);
      newForecast = up.currentForecast + forecastDelta;
    } else if (up.zone === "red_under" || up.zone === "black" || up.zone === "grey" || up.zone === "infinity") {
      // Understocked: use a balanced approach
      // 1. Reduce forecast to conserve stock (if possible)
      // 2. Increase invoiced to replenish stock
      if (deficit > 0 && up.currentForecast > 0 && up.avgNextIms > 0) {
        // Try reducing forecast first (up to 50% of deficit or current forecast, whichever is less)
        const maxForecastReduction = Math.min(up.currentForecast, Math.ceil(deficit * 0.4));
        forecastDelta = -maxForecastReduction;
        newForecast = up.currentForecast - maxForecastReduction;

        // Remaining deficit covered by invoiced (production)
        const remainingDeficit = deficit - maxForecastReduction;
        if (remainingDeficit > 0) {
          invoicedDelta = Math.ceil(remainingDeficit * 2); // 2x because ~50% arrives same month
          newInvoiced = up.currentInvoiced + invoicedDelta;
        }
      } else if (deficit > 0) {
        // Can't reduce forecast (already 0 or no IMS), use invoiced only
        invoicedDelta = Math.ceil(deficit * 2);
        newInvoiced = up.currentInvoiced + invoicedDelta;
      }
    }

    // Skip if no change needed
    if (forecastDelta === 0 && invoicedDelta === 0) continue;

    const actionType = forecastDelta !== 0 && invoicedDelta !== 0 ? "both" :
                       forecastDelta !== 0 ? "forecast" : "invoiced";

    const patch: {
      forecastPeriodId?: number;
      newForecast?: number;
      invoicedPeriodId?: number;
      newInvoiced?: number;
    } = {};

    if (forecastDelta !== 0) {
      patch.forecastPeriodId = up.period.id;
      patch.newForecast = newForecast;
    }
    if (invoicedDelta !== 0) {
      patch.invoicedPeriodId = up.period.id;
      patch.newInvoiced = newInvoiced;
    }

    allPatches.push(patch);

    actions.push({
      periodId: up.period.id,
      periodLabel: up.period.label,
      type: actionType,
      currentForecast: up.currentForecast,
      newForecast,
      forecastDelta,
      currentInvoiced: up.currentInvoiced,
      newInvoiced,
      invoicedDelta,
      beforeWeeks: up.weeks,
      afterWeeks: 0, // Will be computed below
      beforeZone: up.zone,
      afterZone: "green", // Will be computed below
      beforeClosing: up.closingStock,
      afterClosing: 0, // Will be computed below
    });
  }

  // Run combined simulation with all patches to get accurate after-state
  if (allPatches.length > 0) {
    const afterData = runCombinedSimulation(skuId, periods, imsMap, forecastMap, planningMap, allPatches, currentYear, currentMonth);
    for (const action of actions) {
      const data = afterData.get(action.periodId.toString());
      if (data) {
        action.afterWeeks = data.weeks;
        action.afterZone = classifyZone(data.weeks);
        action.afterClosing = data.closing;
      }
    }
  }

  return {
    actions,
    periodsImproved: actions.filter(a => {
      const beforeHealthy = a.beforeZone === "green";
      const afterBetter = classifyZone(a.afterWeeks) === "green" ||
        Math.abs(a.afterWeeks - TARGET_WEEKS) < Math.abs(a.beforeWeeks - TARGET_WEEKS);
      return !beforeHealthy && afterBetter;
    }).length,
    periodsToHealthy: actions.filter(a => a.afterZone === "green").length,
    totalForecastChange: actions.reduce((sum, a) => sum + a.forecastDelta, 0),
    totalInvoicedChange: actions.reduce((sum, a) => sum + a.invoicedDelta, 0),
  };
}

// ── Main BestStrategy component ──────────────────────────────────────────────
export default function BestStrategy({
  skuId, skuName, weight, periods, imsMap, forecastMap, calculateSkuData, onApplied,
}: BestStrategyProps) {
  const { user: appUser } = useAppAuth();
  const utils = trpc.useUtils();
  const containerRef = useRef<HTMLDivElement>(null);

  const syncIms = trpc.update.syncImsAndForecast.useMutation({
    onSuccess: () => {
      utils.data.planningFg.invalidate();
      utils.data.forecast.invalidate();
      utils.data.imsVsForecast.invalidate();
    },
  });

  const invoicedSHP = trpc.update.invoicedSHP.useMutation({
    onSuccess: () => {
      utils.data.planningFg.invalidate();
      utils.data.arrival.invalidate();
    },
  });

  const [isOpen, setIsOpen] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [isApplied, setIsApplied] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Build planningMap
  const planningMap = useMemo(() => {
    const map = new Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>();
    const skuData = calculateSkuData(skuId);
    const sortedPeriods = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const p of sortedPeriods) {
      const openingStock = skuData.get("Opening Stock")?.get(p.id.toString()) ?? 0;
      const adjustments = skuData.get("Adjustments")?.get(p.id.toString()) ?? 0;
      const invoiced = skuData.get("Invoiced (SHP)")?.get(p.id.toString()) ?? 0;
      const arrivals = skuData.get("Actual arrivals / Planned Orders")?.get(p.id.toString()) ?? 0;
      map.set(`${skuId}-${p.id}`, {
        openingStock: openingStock.toString(),
        adjustments: adjustments.toString(),
        invoiced: invoiced.toString(),
        arrivals: arrivals.toString(),
      });
    }
    return map;
  }, [skuId, periods, calculateSkuData]);

  // Compute the best strategy
  const strategy = useMemo(() => {
    return computeBestStrategy(skuId, periods, imsMap, forecastMap, planningMap, currentYear, currentMonth);
  }, [skuId, periods, imsMap, forecastMap, planningMap, currentYear, currentMonth]);

  // Apply all strategy actions
  const handleApplyStrategy = useCallback(async () => {
    if (strategy.actions.length === 0) return;
    setIsApplying(true);

    try {
      for (const action of strategy.actions) {
        // Apply forecast change
        if (action.forecastDelta !== 0) {
          await syncIms.mutateAsync({
            skuId,
            periodId: action.periodId,
            value: action.newForecast.toString(),
            skuName,
            periodLabel: action.periodLabel,
            oldValue: action.currentForecast.toString(),
            source: `Best Strategy - Planning FG ${weight}`,
            country: "Lebanon",
          });
        }

        // Apply invoiced change
        if (action.invoicedDelta !== 0) {
          const weeklyAmount = Math.ceil(action.newInvoiced / 4);
          const w4 = action.newInvoiced - weeklyAmount * 3;
          await invoicedSHP.mutateAsync({
            skuId,
            periodId: action.periodId,
            week1: weeklyAmount,
            week2: weeklyAmount,
            week3: weeklyAmount,
            week4: Math.max(0, w4),
            skuName,
            periodLabel: action.periodLabel,
            country: "Lebanon",
          });
        }

        onApplied?.(skuId, action.periodId);
      }

      setIsApplied(true);
      toast.success(`Best Strategy applied for ${skuName}`, {
        description: `${strategy.actions.length} period${strategy.actions.length !== 1 ? "s" : ""} optimized toward ${TARGET_WEEKS}w target`,
        duration: 5000,
      });
    } catch (err) {
      toast.error("Failed to apply strategy", { description: String(err) });
    } finally {
      setIsApplying(false);
    }
  }, [strategy, syncIms, invoicedSHP, skuId, skuName, weight, appUser, onApplied]);

  const isMutating = syncIms.isPending || invoicedSHP.isPending || isApplying;

  // Don't render if no actions needed (all periods healthy)
  if (strategy.actions.length === 0) return null;

  const fmtNum = (v: number) => {
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    if (v === 0) return "—";
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const fmtWeeks = (v: number) => {
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    return v.toFixed(1) + "w";
  };

  const forecastActions = strategy.actions.filter(a => a.forecastDelta !== 0);
  const invoicedActions = strategy.actions.filter(a => a.invoicedDelta !== 0);

  return (
    <div className="relative" ref={containerRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
        disabled={isApplied}
        className={`h-6 px-2 text-[10px] gap-1 ${
          isApplied
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-violet-300 bg-violet-50 hover:bg-violet-100 text-violet-800"
        }`}
        title={isApplied ? "Strategy already applied" : `Apply optimal Forecast + Production mix for ${strategy.actions.length} periods`}
      >
        {isApplied ? (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Strategy Applied
          </>
        ) : (
          <>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Best Strategy ({strategy.actions.length})
          </>
        )}
      </Button>

      {isOpen && !isApplied && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            className="fixed z-50 w-[620px] max-h-[600px] overflow-y-auto rounded-lg border border-border bg-background shadow-xl"
            style={{
              top: containerRef.current
                ? Math.min(containerRef.current.getBoundingClientRect().bottom + 4, window.innerHeight - 610)
                : 100,
              left: containerRef.current
                ? Math.min(containerRef.current.getBoundingClientRect().left, window.innerWidth - 640)
                : 100,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 z-10 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-violet-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center">
                    <svg className="w-4 h-4 text-violet-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-violet-900">Best Strategy</h3>
                    <p className="text-[10px] text-violet-600">Optimal Forecast + Production mix → target {TARGET_WEEKS}w</p>
                  </div>
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded hover:bg-violet-100 transition-colors text-violet-400 hover:text-violet-600"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Summary stats */}
              <div className="mt-2 flex items-center gap-3 text-[10px]">
                <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/60 border border-violet-200">
                  <span className="text-muted-foreground">Periods:</span>
                  <span className="font-bold text-violet-700">{strategy.actions.length}</span>
                </div>
                {forecastActions.length > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/60 border border-blue-200">
                    <span className="text-muted-foreground">Forecast:</span>
                    <span className={`font-bold ${strategy.totalForecastChange >= 0 ? "text-blue-700" : "text-blue-700"}`}>
                      {strategy.totalForecastChange > 0 ? "+" : ""}{strategy.totalForecastChange.toLocaleString()}
                    </span>
                  </div>
                )}
                {invoicedActions.length > 0 && (
                  <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/60 border border-orange-200">
                    <span className="text-muted-foreground">Production:</span>
                    <span className="font-bold text-orange-700">
                      +{strategy.totalInvoicedChange.toLocaleString()}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-1 px-2 py-1 rounded bg-white/60 border border-emerald-200">
                  <span className="text-muted-foreground">→ Healthy:</span>
                  <span className="font-bold text-emerald-700">{strategy.periodsToHealthy}/{strategy.actions.length}</span>
                </div>
              </div>
            </div>

            {/* Action table */}
            <div className="p-3">
              <div className="overflow-x-auto rounded-md border border-border/50">
                <table className="w-full text-[10px] border-collapse">
                  <thead>
                    <tr className="bg-muted/50 border-b border-border/50">
                      <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">Period</th>
                      <th className="px-2 py-1.5 text-center font-medium text-muted-foreground">Status</th>
                      <th className="px-2 py-1.5 text-center font-medium text-blue-600">Forecast</th>
                      <th className="px-2 py-1.5 text-center font-medium text-orange-600">Production</th>
                      <th className="px-2 py-1.5 text-center font-medium text-slate-600">Closing Stock</th>
                      <th className="px-2 py-1.5 text-center font-medium text-slate-600">Weeks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategy.actions.map(action => {
                      const beforeBadge = ZONE_BADGE[action.beforeZone];
                      const afterBadge = ZONE_BADGE[action.afterZone];
                      return (
                        <tr key={action.periodId} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="px-2 py-1.5 font-medium">{action.periodLabel}</td>
                          <td className="px-2 py-1.5 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${beforeBadge.cls}`}>{beforeBadge.label}</span>
                              <svg className="w-2.5 h-2.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className={`px-1 py-0.5 rounded text-[8px] font-bold ${afterBadge.cls}`}>{afterBadge.label}</span>
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {action.forecastDelta !== 0 ? (
                              <div>
                                <span className={`font-bold ${action.forecastDelta > 0 ? "text-blue-600" : "text-blue-700"}`}>
                                  {action.forecastDelta > 0 ? "+" : ""}{action.forecastDelta.toLocaleString()}
                                </span>
                                <div className="text-[8px] text-muted-foreground">
                                  {action.currentForecast.toLocaleString()} → {action.newForecast.toLocaleString()}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {action.invoicedDelta !== 0 ? (
                              <div>
                                <span className="font-bold text-orange-600">
                                  +{action.invoicedDelta.toLocaleString()}
                                </span>
                                <div className="text-[8px] text-muted-foreground">
                                  {action.currentInvoiced.toLocaleString()} → {action.newInvoiced.toLocaleString()}
                                </div>
                              </div>
                            ) : (
                              <span className="text-muted-foreground/50">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className="text-muted-foreground">{fmtNum(action.beforeClosing)}</span>
                            <span className="mx-0.5 text-muted-foreground/50">→</span>
                            <span className="font-bold">{fmtNum(action.afterClosing)}</span>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className={`px-1 py-0.5 rounded ${weeksStyle(action.beforeWeeks)}`}>
                              {fmtWeeks(action.beforeWeeks)}
                            </span>
                            <span className="mx-0.5 text-muted-foreground/50">→</span>
                            <span className={`px-1 py-0.5 rounded ${weeksStyle(action.afterWeeks)}`}>
                              {fmtWeeks(action.afterWeeks)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Strategy explanation */}
              <div className="mt-3 p-2 rounded bg-muted/30 text-[9px] text-muted-foreground space-y-0.5">
                <p><strong>Strategy logic:</strong> For understocked periods, reduces Forecast by up to 40% of deficit (conserve stock) and adds Production for the remainder (replenish). For overstocked periods, increases Forecast to consume excess.</p>
                <p><strong>Impact:</strong> Forecast changes sync to IMS (two-way). Production changes create Arrivals (~50% same month, ~50% next month).</p>
              </div>

              {/* Apply button */}
              <div className="mt-3 flex items-center justify-between">
                <div className="text-[10px] text-muted-foreground">
                  {strategy.periodsToHealthy === strategy.actions.length
                    ? <span className="text-emerald-600 font-semibold">All {strategy.actions.length} periods will reach healthy zone</span>
                    : <span>{strategy.periodsToHealthy} of {strategy.actions.length} periods will reach healthy zone</span>
                  }
                </div>
                <Button
                  onClick={handleApplyStrategy}
                  disabled={isMutating}
                  className="h-8 px-4 text-xs bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
                >
                  {isApplying ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Applying...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Apply Best Strategy
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
