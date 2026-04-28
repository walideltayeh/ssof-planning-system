import { describe, it, expect } from "vitest";
import { getWeeksStyle, getClosingStockStyle } from "./planningFg.helpers";

describe("getWeeksStyle", () => {
  it("renders 0 weeks as a muted neutral cell", () => {
    expect(getWeeksStyle(0)).toBe("bg-gray-200 text-gray-500 font-bold");
  });

  it("treats negative weeks as a critical (dark) shortage", () => {
    expect(getWeeksStyle(-1)).toBe("bg-gray-900 text-white font-bold");
    expect(getWeeksStyle(-12.5)).toBe("bg-gray-900 text-white font-bold");
  });

  it("warns in red below the 4-week safety floor", () => {
    expect(getWeeksStyle(0.5)).toBe("bg-red-600 text-white font-bold");
    expect(getWeeksStyle(3.99)).toBe("bg-red-600 text-white font-bold");
  });

  it("shows a healthy green band between 4 and 6 weeks (inclusive)", () => {
    expect(getWeeksStyle(4)).toBe("text-emerald-700 font-bold");
    expect(getWeeksStyle(5)).toBe("text-emerald-700 font-bold");
    expect(getWeeksStyle(6)).toBe("text-emerald-700 font-bold");
  });

  it("flags overstock above 6 weeks back to red", () => {
    expect(getWeeksStyle(6.01)).toBe("bg-red-600 text-white font-bold");
    expect(getWeeksStyle(50)).toBe("bg-red-600 text-white font-bold");
  });

  it("treats +Infinity (no IMS denominator) as a purple 'no demand' marker", () => {
    expect(getWeeksStyle(Number.POSITIVE_INFINITY)).toBe(
      "bg-purple-200 text-purple-900 font-bold",
    );
  });

  it("treats -Infinity as a dark critical cell", () => {
    expect(getWeeksStyle(Number.NEGATIVE_INFINITY)).toBe(
      "bg-gray-900 text-white font-bold",
    );
  });
});

describe("getClosingStockStyle", () => {
  it("highlights negative closing stock in red", () => {
    expect(getClosingStockStyle(-1)).toBe("bg-red-100 text-red-800 font-bold");
    expect(getClosingStockStyle(-1000)).toBe("bg-red-100 text-red-800 font-bold");
  });

  it("returns no styling for zero or positive closing stock", () => {
    expect(getClosingStockStyle(0)).toBe("");
    expect(getClosingStockStyle(1)).toBe("");
    expect(getClosingStockStyle(99999)).toBe("");
  });
});
