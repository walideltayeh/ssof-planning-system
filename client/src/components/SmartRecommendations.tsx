import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { useAppAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ── Zone definitions ──────────────────────────────────────────────────────────
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

// ── Types ─────────────────────────────────────────────────────────────────────
type RecType = "forecast" | "invoiced" | "combined";

interface Recommendation {
  id: string;
  type: RecType;
  title: string;
  description: string;
  periodLabel: string;
  periodId: number;
  // Forecast change (if applicable)
  forecastChange?: number;
  currentForecast?: number;
  newForecast?: number;
  forecastPeriodId?: number;
  forecastPeriodLabel?: string;
  // Invoiced change (if applicable)
  invoicedChange?: number;
  currentInvoiced?: number;
  newInvoiced?: number;
  invoicedPeriodId?: number;
  invoicedPeriodLabel?: string;
  // Impact
  productionMonth?: string;
  currentWeeks: number;
  resultingWeeks: number;
  zone: Zone;
  targetPeriodId: number; // The period whose weeks we're trying to fix
}

interface AppliedRec {
  id: string;
  skuId: number;
  type: RecType;
  forecastPeriodId?: number;
  oldForecast?: string;
  newForecast?: string;
  invoicedPeriodId?: number;
  oldInvoiced?: string;
  newInvoiced?: string;
  title: string;
}

// Per-period simulation row
interface SimRow {
  periodId: number;
  periodLabel: string;
  isFuture: boolean;
  beforeForecast: number;
  afterForecast: number;
  beforeInvoiced: number;
  afterInvoiced: number;
  beforeArrivals: number;
  afterArrivals: number;
  beforeClosing: number;
  afterClosing: number;
  beforeWeeks: number;
  afterWeeks: number;
  changed: boolean;
}

export interface SkuRecommendationsProps {
  skuId: number;
  skuName: string;
  weight: string;
  periods: Array<{ id: number; label: string; year: number; month: number; sortOrder: number }>;
  imsMap: Map<string, string>;
  forecastMap: Map<string, string>;
  calculateSkuData: (skuId: number) => Map<string, Map<string, number>>;
  onApplied?: (skuId: number, periodId: number) => void;
  onRolledBack?: (skuId: number, periodId: number) => void;
}

const TARGET_WEEKS = 4.0; // Lower bound of healthy zone (4–6 weeks)

// ── Simulation engine ─────────────────────────────────────────────────────────
// Runs the full Planning FG calculation with patched forecastMap and/or invoiced/arrivals.
function runSimulation(
  skuId: number,
  periods: SkuRecommendationsProps["periods"],
  imsMap: Map<string, string>,
  forecastMap: Map<string, string>,
  planningMap: Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>,
  patches: {
    forecastPeriodId?: number;
    newForecast?: number;
    invoicedPeriodId?: number;
    newInvoiced?: number;
  },
  currentYear: number,
  currentMonth: number,
): SimRow[] {
  const sorted = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);

  // Patched forecastMap for "after" scenario
  const patchedForecastMap = new Map(forecastMap);
  if (patches.forecastPeriodId !== undefined && patches.newForecast !== undefined) {
    patchedForecastMap.set(`${skuId}-${patches.forecastPeriodId}`, patches.newForecast.toString());
  }

  // Patched planningMap for "after" scenario (invoiced + arrivals)
  const patchedPlanningMap = new Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>();
  planningMap.forEach((v, k) => {
    patchedPlanningMap.set(k, { ...v });
  });

  // If we're patching invoiced, also compute the arrival impact (+2 weeks)
  if (patches.invoicedPeriodId !== undefined && patches.newInvoiced !== undefined) {
    const key = `${skuId}-${patches.invoicedPeriodId}`;
    const existing = patchedPlanningMap.get(key);
    if (existing) {
      const oldInvoiced = parseFloat(existing.invoiced) || 0;
      const delta = patches.newInvoiced - oldInvoiced;
      patchedPlanningMap.set(key, { ...existing, invoiced: patches.newInvoiced.toString() });

      // Arrivals: production splits evenly across 4 weeks
      // W1,W2 arrive same month (W3,W4), W3,W4 arrive next month (W1,W2)
      // So ~50% arrives same month, ~50% arrives next month
      const sameMonthArrivalDelta = Math.round(delta / 2);
      const nextMonthArrivalDelta = delta - sameMonthArrivalDelta;

      // Update same-month arrivals
      const oldArrivals = parseFloat(existing.arrivals) || 0;
      patchedPlanningMap.set(key, {
        ...patchedPlanningMap.get(key)!,
        arrivals: (oldArrivals + sameMonthArrivalDelta).toString(),
      });

      // Update next-month arrivals
      const prodIdx = sorted.findIndex(p => p.id === patches.invoicedPeriodId);
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

  const getEffIms = (fMap: Map<string, string>, pMap: typeof planningMap, pid: number): number => {
    const imsVal = parseFloat(imsMap.get(`${skuId}-${pid}`) ?? "0") || 0;
    if (imsVal !== 0) return imsVal;
    const period = sorted.find(p => p.id === pid);
    if (period && (period.year > currentYear || (period.year === currentYear && period.month > currentMonth))) {
      return parseFloat(fMap.get(`${skuId}-${pid}`) ?? "0") || 0;
    }
    return 0;
  };

  const calcAll = (
    fMap: Map<string, string>,
    pMap: typeof planningMap,
  ): Map<string, { closing: number; weeks: number; forecast: number; invoiced: number; arrivals: number }> => {
    const result = new Map<string, { closing: number; weeks: number; forecast: number; invoiced: number; arrivals: number }>();
    let prevClosing = 0;
    for (let i = 0; i < sorted.length; i++) {
      const p = sorted[i];
      const planData = pMap.get(`${skuId}-${p.id}`);
      const ims = getEffIms(fMap, pMap, p.id);
      const arrival = parseFloat(planData?.arrivals ?? "0") || 0;
      const adjustments = parseFloat(planData?.adjustments ?? "0") || 0;
      const invoiced = parseFloat(planData?.invoiced ?? "0") || 0;
      const openingStock = i === 0 ? (parseFloat(planData?.openingStock ?? "0") || 0) : prevClosing;
      const closing = openingStock + adjustments + arrival - ims;
      const forecast = parseFloat(fMap.get(`${skuId}-${p.id}`) ?? "0") || 0;

      let weeks = 0;
      if (closing !== 0) {
        const n1 = i + 1 < sorted.length ? getEffIms(fMap, pMap, sorted[i + 1].id) : 0;
        const n2 = i + 2 < sorted.length ? getEffIms(fMap, pMap, sorted[i + 2].id) : 0;
        const avg = (n1 !== 0 || n2 !== 0) ? (n1 + n2) / 2 : 0;
        weeks = avg !== 0 ? (closing / avg) * 4.3 : closing > 0 ? Infinity : -Infinity;
      }
      result.set(p.id.toString(), { closing, weeks, forecast, invoiced, arrivals: arrival });
      prevClosing = closing;
    }
    return result;
  };

  const before = calcAll(forecastMap, planningMap);
  const after = calcAll(patchedForecastMap, patchedPlanningMap);

  return sorted.map(p => {
    const b = before.get(p.id.toString()) ?? { closing: 0, weeks: 0, forecast: 0, invoiced: 0, arrivals: 0 };
    const a = after.get(p.id.toString()) ?? { closing: 0, weeks: 0, forecast: 0, invoiced: 0, arrivals: 0 };
    const isFuture = p.year > currentYear || (p.year === currentYear && p.month > currentMonth);
    return {
      periodId: p.id,
      periodLabel: p.label,
      isFuture,
      beforeForecast: b.forecast,
      afterForecast: a.forecast,
      beforeInvoiced: b.invoiced,
      afterInvoiced: a.invoiced,
      beforeArrivals: b.arrivals,
      afterArrivals: a.arrivals,
      beforeClosing: b.closing,
      afterClosing: a.closing,
      beforeWeeks: b.weeks,
      afterWeeks: a.weeks,
      changed: Math.abs(b.closing - a.closing) > 0.01 || Math.abs(b.weeks - a.weeks) > 0.01,
    };
  });
}

// ── SimulationPanel component ─────────────────────────────────────────────────
function SimulationPanel({
  rec,
  skuId,
  periods,
  imsMap,
  forecastMap,
  planningMap,
  currentYear,
  currentMonth,
  onApply,
  isMutating,
  isApplied,
}: {
  rec: Recommendation;
  skuId: number;
  periods: SkuRecommendationsProps["periods"];
  imsMap: Map<string, string>;
  forecastMap: Map<string, string>;
  planningMap: Map<string, { openingStock: string; adjustments: string; invoiced: string; arrivals: string }>;
  currentYear: number;
  currentMonth: number;
  onApply: () => void;
  isMutating: boolean;
  isApplied: boolean;
}) {
  const rows = useMemo(() => runSimulation(
    skuId, periods, imsMap, forecastMap, planningMap,
    {
      forecastPeriodId: rec.forecastPeriodId,
      newForecast: rec.newForecast,
      invoicedPeriodId: rec.invoicedPeriodId,
      newInvoiced: rec.newInvoiced,
    },
    currentYear, currentMonth
  ), [skuId, periods, imsMap, forecastMap, planningMap, rec, currentYear, currentMonth]);

  const visibleRows = rows.filter(r => r.isFuture || r.changed);

  const fmtNum = (v: number) => {
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    if (v === 0) return "—";
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  };
  const fmtWeeks = (v: number) => {
    if (!isFinite(v)) return v > 0 ? "∞" : "-∞";
    return v.toFixed(1) + "w";
  };

  const zoneBefore = ZONE_BADGE[rec.zone];
  const zoneAfter = classifyZone(rec.resultingWeeks);
  const zoneAfterBadge = ZONE_BADGE[zoneAfter];

  // Determine which columns to show based on rec type
  const showForecast = rec.type === "forecast" || rec.type === "combined";
  const showInvoiced = rec.type === "invoiced" || rec.type === "combined";

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/30 overflow-hidden">
      <div className="px-2 py-1.5 bg-amber-100/60 border-b border-amber-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-800">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          Simulation Preview
        </div>
        <div className="flex items-center gap-1.5 text-[9px]">
          <span className={`px-1.5 py-0.5 rounded font-bold ${zoneBefore.cls}`}>{zoneBefore.label}</span>
          <svg className="w-3 h-3 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className={`px-1.5 py-0.5 rounded font-bold ${zoneAfterBadge.cls}`}>{zoneAfterBadge.label}</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="bg-muted/30 border-b border-border/50">
              <th className="px-2 py-1 text-left font-medium text-muted-foreground min-w-[80px]">Period</th>
              {showForecast && <th className="px-2 py-1 text-center font-medium text-blue-600" colSpan={2}>Forecast/IMS</th>}
              {showInvoiced && <th className="px-2 py-1 text-center font-medium text-orange-600" colSpan={2}>Invoiced</th>}
              {showInvoiced && <th className="px-2 py-1 text-center font-medium text-teal-600" colSpan={2}>Arrivals</th>}
              <th className="px-2 py-1 text-center font-medium text-slate-600" colSpan={2}>Closing Stock</th>
              <th className="px-2 py-1 text-center font-medium text-slate-600" colSpan={2}>Weeks</th>
            </tr>
            <tr className="bg-muted/20 border-b border-border/50 text-[9px] text-muted-foreground">
              <th></th>
              {showForecast && <><th className="px-1 py-0.5 text-center font-normal">Before</th><th className="px-1 py-0.5 text-center font-normal">After</th></>}
              {showInvoiced && <><th className="px-1 py-0.5 text-center font-normal">Before</th><th className="px-1 py-0.5 text-center font-normal">After</th></>}
              {showInvoiced && <><th className="px-1 py-0.5 text-center font-normal">Before</th><th className="px-1 py-0.5 text-center font-normal">After</th></>}
              <th className="px-1 py-0.5 text-center font-normal">Before</th>
              <th className="px-1 py-0.5 text-center font-normal">After</th>
              <th className="px-1 py-0.5 text-center font-normal">Before</th>
              <th className="px-1 py-0.5 text-center font-normal">After</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => {
              const wBefore = classifyZone(row.beforeWeeks);
              const wAfter = classifyZone(row.afterWeeks);
              return (
                <tr key={row.periodId} className={`border-b border-border/30 ${row.changed ? "bg-amber-50/50" : ""}`}>
                  <td className="px-2 py-0.5 font-medium">{row.periodLabel}</td>
                  {showForecast && (
                    <>
                      <td className="px-1 py-0.5 text-center text-muted-foreground">{fmtNum(row.beforeForecast)}</td>
                      <td className={`px-1 py-0.5 text-center ${row.beforeForecast !== row.afterForecast ? "font-bold text-blue-700" : "text-muted-foreground"}`}>
                        {fmtNum(row.afterForecast)}
                        {row.beforeForecast !== row.afterForecast && (
                          <span className="ml-0.5 text-[8px]">{row.afterForecast > row.beforeForecast ? "▲" : "▼"}</span>
                        )}
                      </td>
                    </>
                  )}
                  {showInvoiced && (
                    <>
                      <td className="px-1 py-0.5 text-center text-muted-foreground">{fmtNum(row.beforeInvoiced)}</td>
                      <td className={`px-1 py-0.5 text-center ${row.beforeInvoiced !== row.afterInvoiced ? "font-bold text-orange-700" : "text-muted-foreground"}`}>
                        {fmtNum(row.afterInvoiced)}
                        {row.beforeInvoiced !== row.afterInvoiced && (
                          <span className="ml-0.5 text-[8px]">▲</span>
                        )}
                      </td>
                    </>
                  )}
                  {showInvoiced && (
                    <>
                      <td className="px-1 py-0.5 text-center text-muted-foreground">{fmtNum(row.beforeArrivals)}</td>
                      <td className={`px-1 py-0.5 text-center ${row.beforeArrivals !== row.afterArrivals ? "font-bold text-teal-700" : "text-muted-foreground"}`}>
                        {fmtNum(row.afterArrivals)}
                        {row.beforeArrivals !== row.afterArrivals && (
                          <span className="ml-0.5 text-[8px]">▲</span>
                        )}
                      </td>
                    </>
                  )}
                  <td className="px-1 py-0.5 text-center text-muted-foreground">{fmtNum(row.beforeClosing)}</td>
                  <td className={`px-1 py-0.5 text-center ${row.changed ? "font-bold" : "text-muted-foreground"}`}>
                    {fmtNum(row.afterClosing)}
                    {row.changed && row.afterClosing !== row.beforeClosing && (
                      <span className="ml-0.5 text-[8px]">{row.afterClosing > row.beforeClosing ? "▲" : "▼"}</span>
                    )}
                  </td>
                  <td className={`px-1 py-0.5 text-center ${weeksStyle(row.beforeWeeks)}`}>{fmtWeeks(row.beforeWeeks)}</td>
                  <td className={`px-1 py-0.5 text-center ${weeksStyle(row.afterWeeks)}`}>
                    {fmtWeeks(row.afterWeeks)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!isApplied && (
        <div className="p-2 border-t border-amber-200 bg-amber-50/50 flex justify-end">
          <Button
            size="sm"
            onClick={onApply}
            disabled={isMutating}
            className="h-6 px-3 text-[10px] bg-emerald-600 hover:bg-emerald-700"
          >
            Apply This Change
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main SkuRecommendations component ─────────────────────────────────────────
export default function SkuRecommendations({
  skuId, skuName, weight, periods, imsMap, forecastMap, calculateSkuData,
  onApplied, onRolledBack,
}: SkuRecommendationsProps) {
  const { user: appUser } = useAppAuth();
  const utils = trpc.useUtils();

  // Mutations
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

  const planningFgCell = trpc.update.planningFgCell.useMutation({
    onSuccess: () => {
      utils.data.planningFg.invalidate();
    },
  });

  // State
  const [appliedRecs, setAppliedRecs] = useState<Map<string, AppliedRec>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isApplyingAll, setIsApplyingAll] = useState(false);
  const [simulatingRecId, setSimulatingRecId] = useState<string | null>(null);

  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded]);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Build planningMap from calculateSkuData
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

  // ── Recommendation engine ─────────────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs: Recommendation[] = [];
    const skuData = calculateSkuData(skuId);
    const sortedPeriods = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);

    const getEffIms = (sid: number, pid: number): number => {
      const imsVal = parseFloat(imsMap.get(`${sid}-${pid}`) ?? "0") || 0;
      if (imsVal !== 0) return imsVal;
      const period = sortedPeriods.find(p => p.id === pid);
      if (period && (period.year > currentYear || (period.year === currentYear && period.month > currentMonth))) {
        return parseFloat(forecastMap.get(`${sid}-${pid}`) ?? "0") || 0;
      }
      return 0;
    };

    for (let i = 0; i < sortedPeriods.length; i++) {
      const p = sortedPeriods[i];
      // Only recommend for future months (current month + 1 onwards)
      if (p.year < currentYear || (p.year === currentYear && p.month <= currentMonth)) continue;

      const weeks = skuData.get("Closing Stock - Weeks")?.get(p.id.toString()) ?? 0;
      const zone = classifyZone(weeks);
      if (zone === "green") continue; // Already healthy, no recommendation needed

      const closingStock = skuData.get("Closing Stock")?.get(p.id.toString()) ?? 0;
      const currentForecast = parseFloat(forecastMap.get(`${skuId}-${p.id}`) ?? "0") || 0;
      const currentInvoiced = skuData.get("Invoiced (SHP)")?.get(p.id.toString()) ?? 0;

      // Average of next 2 months' effective IMS for weeks calculation
      const nextIms1 = i + 1 < sortedPeriods.length ? getEffIms(skuId, sortedPeriods[i + 1].id) : 0;
      const nextIms2 = i + 2 < sortedPeriods.length ? getEffIms(skuId, sortedPeriods[i + 2].id) : 0;
      const avgNextIms = (nextIms1 !== 0 || nextIms2 !== 0) ? (nextIms1 + nextIms2) / 2 : 0;

      // Target closing stock for TARGET_WEEKS
      const targetClosing = avgNextIms > 0 ? (TARGET_WEEKS * avgNextIms) / 4.3 : 0;
      const deficit = targetClosing - closingStock; // positive = need more stock, negative = too much stock

      // Production period is M+4 from the forecast month
      // But for the recommendation, we recommend invoiced at the production period
      // that would result in arrivals at the target period
      // Arrivals take +2 weeks from production, so production at M-1 arrives at M (roughly)
      // For simplicity: recommend invoiced at the period that's ~4 months before target

      // ── OVERSTOCKED (weeks > 6): Increase Forecast/IMS to consume faster ──
      if (zone === "red_over" && avgNextIms > 0) {
        // Need to increase consumption (IMS) to reduce closing stock
        // Increasing forecast → increases effective IMS → reduces closing stock
        const neededReduction = Math.abs(deficit); // deficit is negative for overstock
        const newForecast = Math.max(0, currentForecast + Math.ceil(neededReduction));
        const forecastDelta = newForecast - currentForecast;

        if (forecastDelta > 0) {
          // Simulate to get accurate resulting weeks
          const simRows = runSimulation(
            skuId, sortedPeriods, imsMap, forecastMap, planningMap,
            { forecastPeriodId: p.id, newForecast },
            currentYear, currentMonth
          );
          const simRow = simRows.find(r => r.periodId === p.id);
          const resultingWeeks = simRow?.afterWeeks ?? weeks;

          recs.push({
            id: `${skuId}-${p.id}-forecast-up`,
            type: "forecast",
            title: `Increase Forecast by ${forecastDelta.toLocaleString()}`,
            description: `Increase consumption to reduce overstock`,
            periodLabel: p.label,
            periodId: p.id,
            forecastChange: forecastDelta,
            currentForecast,
            newForecast,
            forecastPeriodId: p.id,
            forecastPeriodLabel: p.label,
            currentWeeks: weeks,
            resultingWeeks: isFinite(resultingWeeks) ? resultingWeeks : TARGET_WEEKS,
            zone,
            targetPeriodId: p.id,
          });
        }
      }

      // ── UNDERSTOCKED / CRITICAL / NO STOCK: Two recommendations ──
      // 1. Reduce Forecast/IMS to conserve stock (immediate effect)
      // 2. Increase Invoiced (production) to replenish stock (takes +4 months)
      if (zone === "red_under" || zone === "black" || zone === "grey" || zone === "infinity") {
        // --- Recommendation 1: Reduce Forecast to conserve stock ---
        if (deficit > 0 && currentForecast > 0 && avgNextIms > 0) {
          const forecastReduction = Math.min(currentForecast, Math.ceil(deficit));
          const newForecast = Math.max(0, currentForecast - forecastReduction);
          const actualReduction = currentForecast - newForecast;

          if (actualReduction > 0) {
            const simRows = runSimulation(
              skuId, sortedPeriods, imsMap, forecastMap, planningMap,
              { forecastPeriodId: p.id, newForecast },
              currentYear, currentMonth
            );
            const simRow = simRows.find(r => r.periodId === p.id);
            const resultingWeeks = simRow?.afterWeeks ?? weeks;

            recs.push({
              id: `${skuId}-${p.id}-forecast-down`,
              type: "forecast",
              title: `Reduce Forecast by ${actualReduction.toLocaleString()}`,
              description: `Conserve stock by reducing planned consumption`,
              periodLabel: p.label,
              periodId: p.id,
              forecastChange: -actualReduction,
              currentForecast,
              newForecast,
              forecastPeriodId: p.id,
              forecastPeriodLabel: p.label,
              currentWeeks: weeks,
              resultingWeeks: isFinite(resultingWeeks) ? resultingWeeks : TARGET_WEEKS,
              zone,
              targetPeriodId: p.id,
            });
          }
        }

        // --- Recommendation 2: Increase Invoiced (production) ---
        // Production should be scheduled for the period that will result in arrivals
        // at the target period. Production at period X → arrivals split between X and X+1.
        // So to get arrivals at period i, we should produce at period i (same month) or i-1.
        // We recommend production at the current period (or earliest future period).
        // The production period for M+1 forecast is M+4 for production.
        // But for invoiced, we recommend at the same period or the earliest actionable period.
        
        // Find the production period: the same period or earliest future period with production lead time
        const prodPeriodIdx = i; // Recommend invoiced at the same period
        const prodPeriod = sortedPeriods[prodPeriodIdx];
        
        if (prodPeriod && deficit > 0) {
          // Need to add enough invoiced to create arrivals that cover the deficit
          // ~50% of invoiced arrives same month, ~50% next month
          // So to get `deficit` in arrivals at this period, we need ~2x invoiced
          const neededInvoiced = Math.ceil(deficit * 2); // Account for 50% split
          const newInvoiced = currentInvoiced + neededInvoiced;

          const simRows = runSimulation(
            skuId, sortedPeriods, imsMap, forecastMap, planningMap,
            { invoicedPeriodId: prodPeriod.id, newInvoiced },
            currentYear, currentMonth
          );
          const simRow = simRows.find(r => r.periodId === p.id);
          const resultingWeeks = simRow?.afterWeeks ?? weeks;

          recs.push({
            id: `${skuId}-${p.id}-invoiced-up`,
            type: "invoiced",
            title: `Add ${neededInvoiced.toLocaleString()} to Invoiced (production)`,
            description: `Schedule production of ${neededInvoiced.toLocaleString()} units at ${prodPeriod.label} → arrivals in ${prodPeriod.label}/${sortedPeriods[prodPeriodIdx + 1]?.label ?? "next"}`,
            periodLabel: p.label,
            periodId: p.id,
            invoicedChange: neededInvoiced,
            currentInvoiced,
            newInvoiced,
            invoicedPeriodId: prodPeriod.id,
            invoicedPeriodLabel: prodPeriod.label,
            productionMonth: prodPeriod.label,
            currentWeeks: weeks,
            resultingWeeks: isFinite(resultingWeeks) ? resultingWeeks : TARGET_WEEKS,
            zone,
            targetPeriodId: p.id,
          });
        }
      }
    }

    return recs;
  }, [skuId, periods, imsMap, forecastMap, calculateSkuData, planningMap, currentYear, currentMonth]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleApply = useCallback(async (rec: Recommendation) => {
    try {
      // Apply forecast change if applicable
      if (rec.type === "forecast" || rec.type === "combined") {
        if (rec.forecastPeriodId !== undefined && rec.newForecast !== undefined) {
          await syncIms.mutateAsync({
            skuId,
            periodId: rec.forecastPeriodId,
            value: rec.newForecast.toString(),
            username: appUser?.displayName,
            skuName,
            periodLabel: rec.forecastPeriodLabel,
            oldValue: rec.currentForecast?.toString(),
            source: `Smart Recommendation - Planning FG ${weight}`,
          });
        }
      }

      // Apply invoiced change if applicable
      if (rec.type === "invoiced" || rec.type === "combined") {
        if (rec.invoicedPeriodId !== undefined && rec.newInvoiced !== undefined) {
          // Split evenly across 4 weeks
          const weeklyAmount = Math.ceil(rec.newInvoiced / 4);
          const w4 = rec.newInvoiced - weeklyAmount * 3; // Remainder goes to W4
          const period = periods.find(p => p.id === rec.invoicedPeriodId);
          await invoicedSHP.mutateAsync({
            skuId,
            periodId: rec.invoicedPeriodId,
            week1: weeklyAmount,
            week2: weeklyAmount,
            week3: weeklyAmount,
            week4: Math.max(0, w4),
            username: appUser?.displayName,
            skuName,
            periodLabel: period?.label,
          });
        }
      }

      setAppliedRecs(prev => {
        const next = new Map(prev);
        next.set(rec.id, {
          id: rec.id,
          skuId,
          type: rec.type,
          forecastPeriodId: rec.forecastPeriodId,
          oldForecast: rec.currentForecast?.toString(),
          newForecast: rec.newForecast?.toString(),
          invoicedPeriodId: rec.invoicedPeriodId,
          oldInvoiced: rec.currentInvoiced?.toString(),
          newInvoiced: rec.newInvoiced?.toString(),
          title: rec.title,
        });
        return next;
      });

      toast.success(`Applied: ${rec.title}`, {
        description: rec.description,
        duration: 4000,
      });
      onApplied?.(skuId, rec.targetPeriodId);
      setSimulatingRecId(null);
    } catch (err) {
      toast.error("Failed to apply recommendation", { description: String(err) });
    }
  }, [syncIms, invoicedSHP, skuId, skuName, weight, appUser, periods, onApplied]);

  const handleRollback = useCallback(async (rec: Recommendation) => {
    const applied = appliedRecs.get(rec.id);
    if (!applied) return;

    try {
      // Rollback forecast
      if ((applied.type === "forecast" || applied.type === "combined") && applied.forecastPeriodId && applied.oldForecast) {
        await syncIms.mutateAsync({
          skuId,
          periodId: applied.forecastPeriodId,
          value: applied.oldForecast,
          username: appUser?.displayName,
          skuName,
          source: `Rollback - Planning FG ${weight}`,
        });
      }

      // Rollback invoiced
      if ((applied.type === "invoiced" || applied.type === "combined") && applied.invoicedPeriodId && applied.oldInvoiced) {
        const oldVal = parseFloat(applied.oldInvoiced) || 0;
        const weeklyAmount = Math.ceil(oldVal / 4);
        const w4 = oldVal - weeklyAmount * 3;
        const period = periods.find(p => p.id === applied.invoicedPeriodId);
        await invoicedSHP.mutateAsync({
          skuId,
          periodId: applied.invoicedPeriodId,
          week1: weeklyAmount,
          week2: weeklyAmount,
          week3: weeklyAmount,
          week4: Math.max(0, w4),
          username: appUser?.displayName,
          skuName,
          periodLabel: period?.label,
        });
      }

      setAppliedRecs(prev => {
        const next = new Map(prev);
        next.delete(rec.id);
        return next;
      });

      toast.info(`Rolled back: ${rec.title}`, { duration: 4000 });
      onRolledBack?.(skuId, rec.targetPeriodId);
    } catch (err) {
      toast.error("Failed to rollback", { description: String(err) });
    }
  }, [syncIms, invoicedSHP, skuId, skuName, weight, appUser, appliedRecs, periods, onRolledBack]);

  const isMutating = syncIms.isPending || invoicedSHP.isPending || planningFgCell.isPending || isApplyingAll;

  const pendingRecs = recommendations.filter(r => !appliedRecs.has(r.id));
  const appliedRecsList = recommendations.filter(r => appliedRecs.has(r.id));

  const handleApplyAll = async () => {
    if (pendingRecs.length === 0) return;
    setIsApplyingAll(true);
    let successCount = 0;
    for (const rec of pendingRecs) {
      try {
        await handleApply(rec);
        successCount++;
      } catch {
        // continue
      }
    }
    setIsApplyingAll(false);
    setSimulatingRecId(null);
    if (successCount > 0) {
      toast.success(`Applied ${successCount} recommendation${successCount !== 1 ? "s" : ""} for ${skuName}`, {
        duration: 5000,
      });
    }
  };

  const handleRollbackAll = async () => {
    if (appliedRecsList.length === 0) return;
    setIsApplyingAll(true);
    let successCount = 0;
    for (const rec of appliedRecsList) {
      try {
        await handleRollback(rec);
        successCount++;
      } catch {
        // continue
      }
    }
    setIsApplyingAll(false);
    if (successCount > 0) {
      toast.info(`Rolled back ${successCount} recommendation${successCount !== 1 ? "s" : ""} for ${skuName}`, {
        duration: 5000,
      });
    }
  };

  const criticalCount = recommendations.filter(r => r.zone === "black" || r.zone === "grey").length;
  const forecastRecs = recommendations.filter(r => r.type === "forecast");
  const invoicedRecs = recommendations.filter(r => r.type === "invoiced");

  // Early return AFTER all hooks
  if (recommendations.length === 0) return null;

  // ── Type badge helper ──
  const typeBadge = (type: RecType) => {
    if (type === "forecast") return <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-blue-100 text-blue-700">FORECAST</span>;
    if (type === "invoiced") return <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-orange-100 text-orange-700">PRODUCTION</span>;
    return <span className="px-1 py-0.5 rounded text-[8px] font-bold bg-purple-100 text-purple-700">COMBINED</span>;
  };

  return (
    <div className="ml-2" ref={containerRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
        {recommendations.length} rec{recommendations.length !== 1 ? "s" : ""}
        {criticalCount > 0 && <span className="text-red-600 font-bold ml-0.5">({criticalCount} critical)</span>}
        <svg className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isExpanded && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsExpanded(false)} />
          <div
            className="fixed z-50 w-[580px] max-h-[560px] overflow-y-auto rounded-lg border border-border bg-background shadow-xl p-3 space-y-2"
            style={{
              top: containerRef.current
                ? Math.min(containerRef.current.getBoundingClientRect().bottom + 4, window.innerHeight - 570)
                : 100,
              left: containerRef.current
                ? Math.min(containerRef.current.getBoundingClientRect().left, window.innerWidth - 600)
                : 100,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-1 border-b border-border/50">
              <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                <span className="font-semibold text-foreground">Smart Recommendations</span>
                <span className="px-1 py-0.5 rounded bg-blue-50 text-blue-600 font-semibold">{forecastRecs.length} Forecast</span>
                <span className="px-1 py-0.5 rounded bg-orange-50 text-orange-600 font-semibold">{invoicedRecs.length} Production</span>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Target info */}
            <div className="text-[9px] text-muted-foreground/80 px-1 flex items-center gap-2">
              <span>Target: <strong className="text-emerald-600">{TARGET_WEEKS}w</strong> (lower bound of healthy 4–6w zone)</span>
              <span className="text-border">|</span>
              <span>Forecast → IMS (two-way sync) · Invoiced → Arrivals (+2w)</span>
            </div>

            {/* Apply All / Rollback All */}
            <div className="flex items-center gap-2 py-1.5 px-1 bg-muted/30 rounded-md">
              <span className="text-[10px] text-muted-foreground flex-1">
                {pendingRecs.length > 0
                  ? `${pendingRecs.length} pending · ${appliedRecsList.length} applied`
                  : `All ${appliedRecsList.length} applied`}
              </span>
              {appliedRecsList.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRollbackAll}
                  disabled={isMutating}
                  className="h-6 px-2 text-[10px] border-red-200 text-red-600 hover:bg-red-50"
                >
                  {isApplyingAll ? "Rolling back…" : `Rollback All (${appliedRecsList.length})`}
                </Button>
              )}
              {pendingRecs.length > 0 && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={handleApplyAll}
                  disabled={isMutating}
                  className="h-6 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700"
                >
                  {isApplyingAll ? "Applying…" : `Apply All (${pendingRecs.length})`}
                </Button>
              )}
            </div>

            {/* Recommendation cards */}
            {recommendations.map(rec => {
              const isApplied = appliedRecs.has(rec.id);
              const zoneBadge = ZONE_BADGE[rec.zone];
              const isSimulating = simulatingRecId === rec.id;

              return (
                <div
                  key={rec.id}
                  className={`rounded-md border text-[11px] overflow-hidden ${
                    isApplied ? "border-emerald-200" : isSimulating ? "border-amber-300" : "border-border/50 hover:border-border"
                  } transition-colors`}
                >
                  <div className={`p-2 ${isApplied ? "bg-emerald-50/50" : isSimulating ? "bg-amber-50/40" : "bg-background"}`}>
                    <div className="flex items-center gap-2 justify-between">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {typeBadge(rec.type)}
                        <span className="font-semibold text-primary shrink-0">{rec.periodLabel}</span>
                        <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${zoneBadge.cls}`}>{zoneBadge.label}</span>
                        <span className="text-muted-foreground truncate">
                          {rec.currentWeeks.toFixed(1)}w → {rec.resultingWeeks.toFixed(1)}w
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isApplied && (
                          <button
                            onClick={() => setSimulatingRecId(isSimulating ? null : rec.id)}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium border transition-colors ${
                              isSimulating
                                ? "bg-amber-100 border-amber-300 text-amber-800"
                                : "bg-muted/50 border-border/50 text-muted-foreground hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700"
                            }`}
                          >
                            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                            {isSimulating ? "Hide" : "Preview"}
                          </button>
                        )}
                        {isApplied ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRollback(rec)}
                            disabled={isMutating}
                            className="h-6 px-2 text-[10px] border-red-200 text-red-600 hover:bg-red-50"
                          >
                            Rollback
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleApply(rec)}
                            disabled={isMutating}
                            className="h-6 px-2 text-[10px]"
                          >
                            Apply
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Change details */}
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                      {rec.type === "forecast" && (
                        <>
                          <span className="px-1 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                            Forecast {(rec.forecastChange ?? 0) > 0 ? "+" : ""}{rec.forecastChange?.toLocaleString()}
                            &nbsp;({rec.currentForecast?.toLocaleString()} → {rec.newForecast?.toLocaleString()})
                          </span>
                          <span className="text-[9px] italic">→ syncs to IMS</span>
                        </>
                      )}
                      {rec.type === "invoiced" && (
                        <>
                          <span className="px-1 py-0.5 rounded bg-orange-50 text-orange-700 font-medium">
                            Invoiced +{rec.invoicedChange?.toLocaleString()}
                            &nbsp;({rec.currentInvoiced?.toLocaleString()} → {rec.newInvoiced?.toLocaleString()})
                          </span>
                          <span className="text-[9px] italic">at {rec.invoicedPeriodLabel} → arrivals +2w</span>
                        </>
                      )}
                    </div>
                  </div>

                  {isSimulating && (
                    <SimulationPanel
                      rec={rec}
                      skuId={skuId}
                      periods={periods}
                      imsMap={imsMap}
                      forecastMap={forecastMap}
                      planningMap={planningMap}
                      currentYear={currentYear}
                      currentMonth={currentMonth}
                      onApply={() => handleApply(rec)}
                      isMutating={isMutating}
                      isApplied={isApplied}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
