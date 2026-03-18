import { describe, it, expect } from "vitest";

// ── Test the analysis computation logic used server-side ──

describe("Analysis: Closing Stock Weeks computation", () => {
  // Replicate the server-side formula: CS = Opening + Adjustments + Arrivals - IMS
  // Weeks = (CS / AVG(next 2 months effective IMS)) * 4.3
  const computeWeeks = (
    closingStock: number,
    nextMonthIms: number,
    nextNextMonthIms: number
  ): number => {
    if (closingStock === 0) return 0;
    const avg = (nextMonthIms !== 0 || nextNextMonthIms !== 0)
      ? (nextMonthIms + nextNextMonthIms) / 2
      : 0;
    if (avg === 0) return closingStock > 0 ? Infinity : -Infinity;
    return (closingStock / avg) * 4.3;
  };

  it("returns 0 when closing stock is 0", () => {
    expect(computeWeeks(0, 100, 200)).toBe(0);
  });

  it("computes weeks correctly with positive closing stock", () => {
    // CS=1000, next2IMS avg = (500+500)/2 = 500, weeks = (1000/500)*4.3 = 8.6
    expect(computeWeeks(1000, 500, 500)).toBeCloseTo(8.6, 1);
  });

  it("computes weeks correctly with different IMS values", () => {
    // CS=200, avg = (300+100)/2 = 200, weeks = (200/200)*4.3 = 4.3
    expect(computeWeeks(200, 300, 100)).toBeCloseTo(4.3, 1);
  });

  it("returns Infinity when no future IMS data", () => {
    expect(computeWeeks(500, 0, 0)).toBe(Infinity);
  });

  it("returns -Infinity when negative CS and no future IMS", () => {
    expect(computeWeeks(-200, 0, 0)).toBe(-Infinity);
  });

  it("handles negative closing stock", () => {
    // CS=-100, avg = (200+200)/2 = 200, weeks = (-100/200)*4.3 = -2.15
    expect(computeWeeks(-100, 200, 200)).toBeCloseTo(-2.15, 1);
  });

  it("handles one zero IMS month", () => {
    // CS=400, avg = (0+600)/2 = 300, weeks = (400/300)*4.3 ≈ 5.73
    expect(computeWeeks(400, 0, 600)).toBeCloseTo(5.733, 1);
  });
});

describe("Analysis: Zone classification", () => {
  const classifyZone = (weeks: number): string => {
    if (!isFinite(weeks) && weeks > 0) return "Overstock";
    if (!isFinite(weeks) && weeks < 0) return "Negative";
    if (weeks === 0) return "Out of Stock";
    if (weeks < 0) return "Negative";
    if (weeks < 4) return "Critical";
    if (weeks <= 6) return "Healthy";
    return "Overstock";
  };

  it("classifies 0 as Out of Stock", () => {
    expect(classifyZone(0)).toBe("Out of Stock");
  });

  it("classifies negative as Negative", () => {
    expect(classifyZone(-2)).toBe("Negative");
  });

  it("classifies < 4 as Critical", () => {
    expect(classifyZone(3.5)).toBe("Critical");
  });

  it("classifies 4-6 as Healthy", () => {
    expect(classifyZone(4)).toBe("Healthy");
    expect(classifyZone(5)).toBe("Healthy");
    expect(classifyZone(6)).toBe("Healthy");
  });

  it("classifies > 6 as Overstock", () => {
    expect(classifyZone(7)).toBe("Overstock");
    expect(classifyZone(10)).toBe("Overstock");
  });

  it("classifies Infinity as Overstock", () => {
    expect(classifyZone(Infinity)).toBe("Overstock");
  });

  it("classifies -Infinity as Negative", () => {
    expect(classifyZone(-Infinity)).toBe("Negative");
  });
});

describe("Analysis: Flavor extraction", () => {
  const extractFlavor = (name: string): string => {
    let flavor = name.replace(/^Al Fakher\s*/i, "").replace(/\s*\d+g$/i, "").replace(/\s*\d+kg$/i, "").trim();
    return flavor || name;
  };

  it("extracts flavor from standard SKU name", () => {
    expect(extractFlavor("Al Fakher Grapes & Mint 1kg")).toBe("Grapes & Mint");
  });

  it("extracts flavor from 250g SKU", () => {
    expect(extractFlavor("Al Fakher Two Apples 250g")).toBe("Two Apples");
  });

  it("extracts flavor from 50g SKU", () => {
    expect(extractFlavor("Al Fakher Mint 50g")).toBe("Mint");
  });

  it("handles SKU without Al Fakher prefix", () => {
    expect(extractFlavor("Special Blend 1kg")).toBe("Special Blend");
  });

  it("returns original name if no pattern matches", () => {
    expect(extractFlavor("CustomSKU")).toBe("CustomSKU");
  });
});

describe("Analysis: Production efficiency", () => {
  const sumWeeks = (w1: number, w2: number, w3: number, w4: number) => w1 + w2 + w3 + w4;

  it("sums weekly values correctly", () => {
    expect(sumWeeks(100, 200, 150, 250)).toBe(700);
  });

  it("computes efficiency as arrived/shipped * 100", () => {
    const shipped = 1000;
    const arrived = 800;
    expect(Math.round(arrived / shipped * 100)).toBe(80);
  });

  it("handles zero shipped as 0% efficiency", () => {
    const shipped = 0;
    const arrived = 0;
    expect(shipped > 0 ? Math.round(arrived / shipped * 100) : 0).toBe(0);
  });

  it("computes gap as shipped - arrived", () => {
    expect(1000 - 800).toBe(200);
    expect(500 - 600).toBe(-100);
  });
});

describe("Shipment/Arrival: Full Year totals", () => {
  // FY total = sum of all monthly totals for that year
  const periods = [
    { year: 2025, month: 1, total: 100 },
    { year: 2025, month: 2, total: 200 },
    { year: 2025, month: 3, total: 150 },
    { year: 2026, month: 1, total: 300 },
    { year: 2026, month: 2, total: 400 },
  ];

  it("computes FY 2025 total correctly", () => {
    const fy2025 = periods.filter(p => p.year === 2025).reduce((s, p) => s + p.total, 0);
    expect(fy2025).toBe(450);
  });

  it("computes FY 2026 total correctly", () => {
    const fy2026 = periods.filter(p => p.year === 2026).reduce((s, p) => s + p.total, 0);
    expect(fy2026).toBe(700);
  });

  it("handles empty year", () => {
    const fy2024 = periods.filter(p => p.year === 2024).reduce((s, p) => s + p.total, 0);
    expect(fy2024).toBe(0);
  });
});

describe("Analysis: Forecast accuracy", () => {
  it("computes accuracy as min(IMS/Forecast, 2) * 100", () => {
    // Perfect accuracy
    expect(Math.min(500 / 500, 2) * 100).toBe(100);
    // Under-forecast
    expect(Math.min(800 / 500, 2) * 100).toBe(160);
    // Over-forecast
    expect(Math.min(200 / 500, 2) * 100).toBe(40);
    // Capped at 200%
    expect(Math.min(1500 / 500, 2) * 100).toBe(200);
  });

  it("handles zero forecast as 0 accuracy", () => {
    const forecast = 0;
    const accuracy = forecast > 0 ? Math.min(100 / forecast, 2) : 0;
    expect(accuracy).toBe(0);
  });
});

describe("Stock Snapshot: zone classification", () => {
  const classifyZone = (w: number): string => {
    if (w <= 0) return w < 0 ? "Negative" : "Out of Stock";
    if (w < 4) return "Critical";
    if (w <= 6) return "Healthy";
    return "Overstock";
  };

  it("classifies 0 weeks as Out of Stock", () => {
    expect(classifyZone(0)).toBe("Out of Stock");
  });
  it("classifies negative weeks as Negative", () => {
    expect(classifyZone(-1)).toBe("Negative");
  });
  it("classifies 1w as Critical", () => {
    expect(classifyZone(1)).toBe("Critical");
  });
  it("classifies 3.9w as Critical", () => {
    expect(classifyZone(3.9)).toBe("Critical");
  });
  it("classifies 4w as Healthy", () => {
    expect(classifyZone(4)).toBe("Healthy");
  });
  it("classifies 5w as Healthy", () => {
    expect(classifyZone(5)).toBe("Healthy");
  });
  it("classifies 6w as Healthy", () => {
    expect(classifyZone(6)).toBe("Healthy");
  });
  it("classifies 6.1w as Overstock", () => {
    expect(classifyZone(6.1)).toBe("Overstock");
  });
  it("classifies 10w as Overstock", () => {
    expect(classifyZone(10)).toBe("Overstock");
  });
});

describe("Stock Snapshot: trend computation", () => {
  const computeTrend = (weeks: number[]): string => {
    const mid = Math.floor(weeks.length / 2);
    const firstHalfAvg = weeks.slice(0, mid).reduce((s, w) => s + Math.min(w, 12), 0) / (mid || 1);
    const secondHalfAvg = weeks.slice(mid).reduce((s, w) => s + Math.min(w, 12), 0) / ((weeks.length - mid) || 1);
    return secondHalfAvg - firstHalfAvg > 0.5 ? "improving" :
      firstHalfAvg - secondHalfAvg > 0.5 ? "deteriorating" : "stable";
  };

  it("detects improving trend", () => {
    expect(computeTrend([2, 3, 4, 5, 6, 7])).toBe("improving");
  });
  it("detects deteriorating trend", () => {
    expect(computeTrend([7, 6, 5, 4, 3, 2])).toBe("deteriorating");
  });
  it("detects stable trend", () => {
    expect(computeTrend([5, 5, 5, 5, 5, 5])).toBe("stable");
  });
  it("handles two identical periods as stable", () => {
    expect(computeTrend([4, 4])).toBe("stable");
  });
  it("caps weeks at 12 for trend computation", () => {
    expect(computeTrend([99, 99, 99, 99, 99, 99])).toBe("stable");
  });
});

describe("Stock Snapshot: health score", () => {
  const computeHealthScore = (periods: string[]): number => {
    const healthy = periods.filter(z => z === "Healthy").length;
    return periods.length > 0 ? Math.round(healthy / periods.length * 100) : 100;
  };

  it("returns 100% for all healthy periods", () => {
    expect(computeHealthScore(["Healthy", "Healthy", "Healthy"])).toBe(100);
  });
  it("returns 0% for all critical periods", () => {
    expect(computeHealthScore(["Critical", "Critical", "Critical"])).toBe(0);
  });
  it("returns 50% for half healthy", () => {
    expect(computeHealthScore(["Healthy", "Healthy", "Critical", "Critical"])).toBe(50);
  });
  it("returns 100% for empty periods", () => {
    expect(computeHealthScore([])).toBe(100);
  });
  it("rounds correctly", () => {
    expect(computeHealthScore(["Healthy", "Critical", "Critical"])).toBe(33);
  });
});
