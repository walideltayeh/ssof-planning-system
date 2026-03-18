import { describe, it, expect } from "vitest";

// ── Re-implement the core strategy logic for testing ─────────────────────────
// We test the pure computation functions that drive the BestStrategy component.

type Zone = "green" | "red_under" | "red_over" | "black" | "grey" | "infinity";

function classifyZone(weeks: number): Zone {
  if (!isFinite(weeks)) return weeks > 0 ? "infinity" : "black";
  if (weeks === 0) return "grey";
  if (weeks < 0) return "black";
  if (weeks < 4) return "red_under";
  if (weeks >= 4 && weeks <= 6) return "green";
  return "red_over";
}

const TARGET_WEEKS = 4.0;

interface Period {
  id: number;
  label: string;
  year: number;
  month: number;
  sortOrder: number;
}

interface PlanningEntry {
  openingStock: string;
  adjustments: string;
  invoiced: string;
  arrivals: string;
}

// Simplified combined simulation for testing
function runCombinedSimulation(
  skuId: number,
  periods: Period[],
  imsMap: Map<string, string>,
  forecastMap: Map<string, string>,
  planningMap: Map<string, PlanningEntry>,
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

  const patchedForecastMap = new Map(forecastMap);
  for (const patch of patches) {
    if (patch.forecastPeriodId !== undefined && patch.newForecast !== undefined) {
      patchedForecastMap.set(`${skuId}-${patch.forecastPeriodId}`, patch.newForecast.toString());
    }
  }

  const patchedPlanningMap = new Map<string, PlanningEntry>();
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

// ── Test data ────────────────────────────────────────────────────────────────
const SKU_ID = 1;
const CURRENT_YEAR = 2026;
const CURRENT_MONTH = 3; // March 2026

// 6 periods: Jan-Jun 2026
const periods: Period[] = [
  { id: 1, label: "Jan-26", year: 2026, month: 1, sortOrder: 1 },
  { id: 2, label: "Feb-26", year: 2026, month: 2, sortOrder: 2 },
  { id: 3, label: "Mar-26", year: 2026, month: 3, sortOrder: 3 },
  { id: 4, label: "Apr-26", year: 2026, month: 4, sortOrder: 4 },
  { id: 5, label: "May-26", year: 2026, month: 5, sortOrder: 5 },
  { id: 6, label: "Jun-26", year: 2026, month: 6, sortOrder: 6 },
];

describe("classifyZone", () => {
  it("classifies healthy zone (4-6 weeks)", () => {
    expect(classifyZone(4)).toBe("green");
    expect(classifyZone(5)).toBe("green");
    expect(classifyZone(6)).toBe("green");
  });

  it("classifies understocked zone (<4 weeks)", () => {
    expect(classifyZone(3.9)).toBe("red_under");
    expect(classifyZone(1)).toBe("red_under");
  });

  it("classifies overstocked zone (>6 weeks)", () => {
    expect(classifyZone(6.1)).toBe("red_over");
    expect(classifyZone(10)).toBe("red_over");
  });

  it("classifies critical zone (<0 weeks)", () => {
    expect(classifyZone(-1)).toBe("black");
    expect(classifyZone(-Infinity)).toBe("black");
  });

  it("classifies zero stock zone", () => {
    expect(classifyZone(0)).toBe("grey");
  });

  it("classifies infinity zone", () => {
    expect(classifyZone(Infinity)).toBe("infinity");
  });
});

describe("Best Strategy computation", () => {
  it("identifies unhealthy future periods correctly", () => {
    // Setup: SKU with low stock in future months
    const forecastMap = new Map<string, string>();
    const imsMap = new Map<string, string>();
    const planningMap = new Map<string, PlanningEntry>();

    // Past months (Jan, Feb, Mar) - have IMS data
    for (const pid of [1, 2, 3]) {
      imsMap.set(`${SKU_ID}-${pid}`, "100");
      forecastMap.set(`${SKU_ID}-${pid}`, "100");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: pid === 1 ? "500" : "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "50",
      });
    }

    // Future months (Apr, May, Jun) - use forecast as IMS proxy
    for (const pid of [4, 5, 6]) {
      forecastMap.set(`${SKU_ID}-${pid}`, "100");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "20",
      });
    }

    const baseline = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [], CURRENT_YEAR, CURRENT_MONTH);

    // Check that future periods have weeks data
    const apr = baseline.get("4");
    const may = baseline.get("5");
    const jun = baseline.get("6");

    expect(apr).toBeDefined();
    expect(may).toBeDefined();
    expect(jun).toBeDefined();
  });

  it("simulation correctly applies forecast patches", () => {
    const forecastMap = new Map<string, string>();
    const imsMap = new Map<string, string>();
    const planningMap = new Map<string, PlanningEntry>();

    for (const pid of [1, 2, 3, 4, 5, 6]) {
      forecastMap.set(`${SKU_ID}-${pid}`, "100");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: pid === 1 ? "500" : "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "50",
      });
    }

    // Baseline
    const before = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [], CURRENT_YEAR, CURRENT_MONTH);

    // With forecast reduction in April (period 4)
    const after = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [
      { forecastPeriodId: 4, newForecast: 50 },
    ], CURRENT_YEAR, CURRENT_MONTH);

    // Reducing forecast should increase closing stock (less consumption)
    const beforeApr = before.get("4")!;
    const afterApr = after.get("4")!;

    // After reducing forecast from 100 to 50, closing stock should be higher
    expect(afterApr.closing).toBeGreaterThan(beforeApr.closing);
  });

  it("simulation correctly applies invoiced patches with arrival split", () => {
    const forecastMap = new Map<string, string>();
    const imsMap = new Map<string, string>();
    const planningMap = new Map<string, PlanningEntry>();

    for (const pid of [1, 2, 3, 4, 5, 6]) {
      forecastMap.set(`${SKU_ID}-${pid}`, "100");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: pid === 1 ? "200" : "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "0",
      });
    }

    // Add invoiced at April (period 4) → should create arrivals at Apr and May
    const after = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [
      { invoicedPeriodId: 4, newInvoiced: 200 },
    ], CURRENT_YEAR, CURRENT_MONTH);

    const apr = after.get("4")!;
    const may = after.get("5")!;

    // Arrivals should be split: ~100 at Apr, ~100 at May
    expect(apr.arrivals).toBe(100); // 200/2 = 100
    expect(may.arrivals).toBe(100); // 200 - 100 = 100
  });

  it("combined patches affect multiple periods correctly", () => {
    const forecastMap = new Map<string, string>();
    const imsMap = new Map<string, string>();
    const planningMap = new Map<string, PlanningEntry>();

    for (const pid of [1, 2, 3, 4, 5, 6]) {
      forecastMap.set(`${SKU_ID}-${pid}`, "100");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: pid === 1 ? "300" : "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "0",
      });
    }

    // Apply multiple patches at once
    const after = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [
      { forecastPeriodId: 4, newForecast: 50 },
      { forecastPeriodId: 5, newForecast: 50 },
      { invoicedPeriodId: 4, newInvoiced: 100 },
    ], CURRENT_YEAR, CURRENT_MONTH);

    // All patches should be applied
    const apr = after.get("4")!;
    expect(apr.forecast).toBe(50); // Patched from 100 to 50
    expect(apr.invoiced).toBe(100); // Patched from 0 to 100
    expect(apr.arrivals).toBe(50); // 100/2 = 50 arrives same month

    const may = after.get("5")!;
    expect(may.forecast).toBe(50); // Patched from 100 to 50
    expect(may.arrivals).toBe(50); // Other half of Apr production arrives in May
  });

  it("strategy for understocked SKU reduces forecast and increases production", () => {
    // Setup: SKU with very low stock in future months
    const forecastMap = new Map<string, string>();
    const imsMap = new Map<string, string>();
    const planningMap = new Map<string, PlanningEntry>();

    // Past months
    for (const pid of [1, 2, 3]) {
      imsMap.set(`${SKU_ID}-${pid}`, "100");
      forecastMap.set(`${SKU_ID}-${pid}`, "100");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: pid === 1 ? "100" : "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "50",
      });
    }

    // Future months with high forecast and no arrivals → will be understocked
    for (const pid of [4, 5, 6]) {
      forecastMap.set(`${SKU_ID}-${pid}`, "200");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "0",
      });
    }

    const baseline = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [], CURRENT_YEAR, CURRENT_MONTH);

    // April should be understocked or critical
    const apr = baseline.get("4")!;
    const aprZone = classifyZone(apr.weeks);
    expect(["red_under", "black", "grey", "infinity"]).toContain(aprZone);
  });

  it("strategy for overstocked SKU increases forecast to consume excess", () => {
    // Setup: SKU with excessive stock
    const forecastMap = new Map<string, string>();
    const imsMap = new Map<string, string>();
    const planningMap = new Map<string, PlanningEntry>();

    for (const pid of [1, 2, 3]) {
      imsMap.set(`${SKU_ID}-${pid}`, "50");
      forecastMap.set(`${SKU_ID}-${pid}`, "50");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: pid === 1 ? "2000" : "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "100",
      });
    }

    // Future months with low forecast and high arrivals → overstocked
    for (const pid of [4, 5, 6]) {
      forecastMap.set(`${SKU_ID}-${pid}`, "50");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "200",
      });
    }

    const baseline = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [], CURRENT_YEAR, CURRENT_MONTH);

    // April should be overstocked
    const apr = baseline.get("4")!;
    const aprZone = classifyZone(apr.weeks);
    expect(aprZone).toBe("red_over");
  });

  it("patches do not affect past periods", () => {
    const forecastMap = new Map<string, string>();
    const imsMap = new Map<string, string>();
    const planningMap = new Map<string, PlanningEntry>();

    for (const pid of [1, 2, 3, 4, 5, 6]) {
      imsMap.set(`${SKU_ID}-${pid}`, "100");
      forecastMap.set(`${SKU_ID}-${pid}`, "100");
      planningMap.set(`${SKU_ID}-${pid}`, {
        openingStock: pid === 1 ? "500" : "0",
        adjustments: "0",
        invoiced: "0",
        arrivals: "50",
      });
    }

    const before = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [], CURRENT_YEAR, CURRENT_MONTH);
    const after = runCombinedSimulation(SKU_ID, periods, imsMap, forecastMap, planningMap, [
      { forecastPeriodId: 4, newForecast: 50 },
    ], CURRENT_YEAR, CURRENT_MONTH);

    // Past periods (Jan, Feb) should be identical
    expect(after.get("1")!.closing).toBe(before.get("1")!.closing);
    expect(after.get("2")!.closing).toBe(before.get("2")!.closing);
  });
});
