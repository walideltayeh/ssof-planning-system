import { describe, expect, it } from "vitest";

/**
 * Tests for Planning FG formula calculations.
 * These test the same formulas used in PlanningFgPage.tsx on the frontend.
 * 
 * Formulas (verified against original Excel):
 * - Opening Stock (month 1) = from uploaded data (manual)
 * - Opening Stock (month N) = Closing Stock (month N-1)
 * - Closing Stock = Opening Stock + Adjustments + Arrivals - IMS
 *   Excel: =D3+D4+D7-D5 (Opening + Adj + Arrivals - IMS)
 *   NOTE: Invoiced (SHP) is NOT used in Closing Stock formula
 * - Closing Stock Weeks = IF(CS=0, 0, IFERROR((CS / AVERAGE(IMS_next1, IMS_next2)) * 4.3, "∞"))
 *   Uses AVERAGE of NEXT TWO months' IMS, multiplied by 4.3
 *   Crosses year boundaries
 */

// Replicate the calculation logic from PlanningFgPage
function calculatePlanningFg(params: {
  periods: { id: number; sortOrder: number }[];
  planningData: Map<string, { openingStock: number; adjustments: number }>;
  imsData: Map<string, number>;
  shipmentData: Map<string, number>;
  arrivalData: Map<string, number>;
  skuId: number;
}) {
  const { periods, planningData, imsData, shipmentData, arrivalData, skuId } = params;
  const sorted = [...periods].sort((a, b) => a.sortOrder - b.sortOrder);

  const results: {
    periodId: number;
    openingStock: number;
    adjustments: number;
    ims: number;
    shipment: number;
    arrival: number;
    closingStock: number;
    closingStockWeeks: number;
  }[] = [];

  let prevClosingStock = 0;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const planData = planningData.get(`${skuId}-${p.id}`);
    const ims = imsData.get(`${skuId}-${p.id}`) ?? 0;
    const shipment = shipmentData.get(`${skuId}-${p.id}`) ?? 0;
    const arrival = arrivalData.get(`${skuId}-${p.id}`) ?? 0;

    // Opening Stock: first month = manual, all others = previous Closing Stock
    let openingStock: number;
    if (i === 0) {
      openingStock = planData?.openingStock ?? 0;
    } else {
      openingStock = prevClosingStock;
    }

    const adjustments = planData?.adjustments ?? 0;

    // Closing Stock = Opening + Adjustments + Arrivals - IMS
    const closingStock = openingStock + adjustments + arrival - ims;

    // Weeks of Stock = IF(CS=0, 0, (CS / AVERAGE(IMS_next1, IMS_next2)) * 4.3)
    let weeksOfStock = 0;
    if (closingStock !== 0) {
      const nextIms1 = i + 1 < sorted.length
        ? imsData.get(`${skuId}-${sorted[i + 1].id}`) ?? 0
        : 0;
      const nextIms2 = i + 2 < sorted.length
        ? imsData.get(`${skuId}-${sorted[i + 2].id}`) ?? 0
        : 0;

      const avg = (nextIms1 !== 0 || nextIms2 !== 0) ? (nextIms1 + nextIms2) / 2 : 0;

      if (avg !== 0) {
        weeksOfStock = (closingStock / avg) * 4.3;
      } else {
        weeksOfStock = closingStock > 0 ? Infinity : -Infinity;
      }
    }

    results.push({
      periodId: p.id,
      openingStock,
      adjustments,
      ims,
      shipment,
      arrival,
      closingStock,
      closingStockWeeks: weeksOfStock,
    });

    prevClosingStock = closingStock;
  }

  return results;
}

describe("Planning FG Calculations", () => {
  it("calculates closing stock correctly: Opening + Adj + Arrival - IMS", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
    ];
    const planningData = new Map([
      ["100-1", { openingStock: 5000, adjustments: 0 }],
      ["100-2", { openingStock: 0, adjustments: 200 }],
    ]);
    const imsData = new Map([
      ["100-1", 1000],
      ["100-2", 1200],
    ]);
    const shipmentData = new Map([
      ["100-1", 500],
      ["100-2", 600],
    ]);
    const arrivalData = new Map([
      ["100-1", 800],
      ["100-2", 900],
    ]);

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 100,
    });

    // Month 1: Opening=5000, Adj=0, Arrival=800, IMS=1000
    // Closing = 5000 + 0 + 800 - 1000 = 4800
    expect(results[0].closingStock).toBe(4800);

    // Month 2: Opening=4800 (prev closing), Adj=200, Arrival=900, IMS=1200
    // Closing = 4800 + 200 + 900 - 1200 = 4700
    expect(results[1].openingStock).toBe(4800);
    expect(results[1].closingStock).toBe(4700);
  });

  it("carries over closing stock as next month opening stock", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 10000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 2000],
      ["1-2", 3000],
      ["1-3", 1500],
    ]);
    const arrivalData = new Map([
      ["1-1", 1000],
      ["1-2", 2000],
      ["1-3", 500],
    ]);
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Month 1: 10000 + 0 + 1000 - 2000 = 9000
    expect(results[0].closingStock).toBe(9000);
    // Month 2: 9000 + 0 + 2000 - 3000 = 8000
    expect(results[1].openingStock).toBe(9000);
    expect(results[1].closingStock).toBe(8000);
    // Month 3: 8000 + 0 + 500 - 1500 = 7000
    expect(results[2].openingStock).toBe(8000);
    expect(results[2].closingStock).toBe(7000);
  });

  it("calculates weeks of stock using AVERAGE of next 2 months IMS * 4.3", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 5000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 1000],
      ["1-2", 2000],
      ["1-3", 3000],
    ]);
    const arrivalData = new Map([
      ["1-1", 500],
    ]);
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Month 1: Closing = 5000 + 0 + 500 - 1000 = 4500
    // Weeks = (4500 / AVERAGE(2000, 3000)) * 4.3 = (4500 / 2500) * 4.3 = 1.8 * 4.3 = 7.74
    expect(results[0].closingStock).toBe(4500);
    expect(results[0].closingStockWeeks).toBeCloseTo(7.74, 2);
  });

  it("handles weeks when only one future month IMS exists", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 5000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 1000],
      ["1-2", 2000],
      // No period 3, so next2 IMS = 0
    ]);
    const arrivalData = new Map([
      ["1-1", 500],
    ]);
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Month 1: Closing = 5000 + 0 + 500 - 1000 = 4500
    // Weeks = (4500 / AVERAGE(2000, 0)) * 4.3 = (4500 / 1000) * 4.3 = 4.5 * 4.3 = 19.35
    expect(results[0].closingStock).toBe(4500);
    expect(results[0].closingStockWeeks).toBeCloseTo(19.35, 2);
  });

  it("shows infinity when both next months IMS are 0 and closing stock > 0", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 3000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 1000],
      ["1-2", 0],
      ["1-3", 0],
    ]);
    const arrivalData = new Map<string, number>();
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Month 1: Closing = 3000 + 0 + 0 - 1000 = 2000
    // Weeks: AVERAGE(0, 0) = 0, closing > 0 → Infinity
    expect(results[0].closingStock).toBe(2000);
    expect(results[0].closingStockWeeks).toBe(Infinity);
  });

  it("shows 0 weeks when closing stock is 0", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 1000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 1000],
      ["1-2", 500],
      ["1-3", 500],
    ]);
    const arrivalData = new Map<string, number>();
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Month 1: Closing = 1000 + 0 + 0 - 1000 = 0
    // Weeks: closing is 0 → 0
    expect(results[0].closingStock).toBe(0);
    expect(results[0].closingStockWeeks).toBe(0);
  });

  it("handles negative closing stock correctly", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 500, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 2000],
      ["1-2", 1000],
      ["1-3", 1000],
    ]);
    const arrivalData = new Map([
      ["1-1", 100],
    ]);
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Closing = 500 + 0 + 100 - 2000 = -1400
    // Weeks = (-1400 / AVERAGE(1000, 1000)) * 4.3 = (-1400 / 1000) * 4.3 = -6.02
    expect(results[0].closingStock).toBe(-1400);
    expect(results[0].closingStockWeeks).toBeCloseTo(-6.02, 2);
  });

  it("handles adjustments correctly", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 1000, adjustments: -300 }],
    ]);
    const imsData = new Map([
      ["1-1", 500],
      ["1-2", 400],
      ["1-3", 400],
    ]);
    const arrivalData = new Map([
      ["1-1", 200],
    ]);
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Closing = 1000 + (-300) + 200 - 500 = 400
    expect(results[0].closingStock).toBe(400);
    // Weeks = (400 / AVERAGE(400, 400)) * 4.3 = (400 / 400) * 4.3 = 4.3
    expect(results[0].closingStockWeeks).toBeCloseTo(4.3, 2);
  });

  it("shipment data does NOT affect closing stock (only arrival does)", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
      { id: 2, sortOrder: 1 },
      { id: 3, sortOrder: 2 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 5000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 1000],
      ["1-2", 1000],
      ["1-3", 1000],
    ]);
    // Shipment is 10000 but should NOT affect closing stock
    const shipmentData = new Map([
      ["1-1", 10000],
    ]);
    const arrivalData = new Map([
      ["1-1", 500],
    ]);

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Closing = 5000 + 0 + 500 - 1000 = 4500 (shipment NOT included)
    expect(results[0].closingStock).toBe(4500);
  });

  it("weeks formula crosses year boundaries correctly", () => {
    // Simulate 3 periods: Nov 2025, Dec 2025, Jan 2026
    const periods = [
      { id: 11, sortOrder: 10 }, // Nov
      { id: 12, sortOrder: 11 }, // Dec
      { id: 13, sortOrder: 12 }, // Jan next year
    ];
    const planningData = new Map([
      ["1-11", { openingStock: 5000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-11", 1000],
      ["1-12", 800],
      ["1-13", 1200],
    ]);
    const arrivalData = new Map<string, number>();
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Nov: Closing = 5000 + 0 + 0 - 1000 = 4000
    // Nov Weeks = (4000 / AVERAGE(Dec_IMS=800, Jan_IMS=1200)) * 4.3
    //           = (4000 / 1000) * 4.3 = 17.2
    expect(results[0].closingStock).toBe(4000);
    expect(results[0].closingStockWeeks).toBeCloseTo(17.2, 2);

    // Dec: Opening = 4000, Closing = 4000 + 0 + 0 - 800 = 3200
    // Dec Weeks = (3200 / AVERAGE(Jan_IMS=1200, 0)) * 4.3
    //           = (3200 / 600) * 4.3 = 22.93...
    expect(results[1].closingStock).toBe(3200);
    expect(results[1].closingStockWeeks).toBeCloseTo(22.933, 1);
  });

  it("last period with no future months shows infinity when CS > 0", () => {
    const periods = [
      { id: 1, sortOrder: 0 },
    ];
    const planningData = new Map([
      ["1-1", { openingStock: 5000, adjustments: 0 }],
    ]);
    const imsData = new Map([
      ["1-1", 1000],
    ]);
    const arrivalData = new Map<string, number>();
    const shipmentData = new Map<string, number>();

    const results = calculatePlanningFg({
      periods,
      planningData,
      imsData,
      shipmentData,
      arrivalData,
      skuId: 1,
    });

    // Closing = 5000 + 0 + 0 - 1000 = 4000
    // No next months → avg = 0, CS > 0 → Infinity
    expect(results[0].closingStock).toBe(4000);
    expect(results[0].closingStockWeeks).toBe(Infinity);
  });
});

describe("Weight normalization", () => {
  // Test the weight normalization logic used in upload
  function normalizeWeight(rawWeight: string, skuName: string): string {
    const lower = rawWeight.toLowerCase().trim();
    // Check specific values first, then patterns (order matters: 1000 before 50 to avoid false matches)
    if (lower === "1000" || lower === "1kg" || lower === "1000g" || lower.includes("1kg") || lower.includes("1000")) return "1kg";
    if (lower === "250" || lower === "250g" || lower.includes("250")) return "250g";
    if (lower === "50" || lower === "50g" || lower.includes("50")) return "50g";
    // Fallback: check SKU name
    const nameLower = skuName.toLowerCase();
    if (nameLower.includes("1kg") || nameLower.includes("1000g")) return "1kg";
    if (nameLower.includes("250g") || nameLower.includes("250")) return "250g";
    return "50g";
  }

  it("normalizes standard weight values", () => {
    expect(normalizeWeight("50", "Test")).toBe("50g");
    expect(normalizeWeight("250", "Test")).toBe("250g");
    expect(normalizeWeight("1000", "Test")).toBe("1kg");
  });

  it("normalizes weight with g suffix", () => {
    expect(normalizeWeight("50g", "Test")).toBe("50g");
    expect(normalizeWeight("250g", "Test")).toBe("250g");
    expect(normalizeWeight("1kg", "Test")).toBe("1kg");
  });

  it("falls back to SKU name for weight detection", () => {
    expect(normalizeWeight("100", "Al Fakher Lemon Mint 250g")).toBe("250g");
    expect(normalizeWeight("", "Some Product 1kg")).toBe("1kg");
    expect(normalizeWeight("", "Al Fakher Grape 50g")).toBe("50g");
  });

  it("defaults to 50g when no match", () => {
    expect(normalizeWeight("", "Unknown Product")).toBe("50g");
  });
});
