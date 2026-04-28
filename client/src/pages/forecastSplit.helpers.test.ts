import { describe, it, expect } from "vitest";
import {
  MONTHS,
  SHORT_MONTHS,
  getConsecutiveMonths,
} from "./forecastSplit.helpers";

describe("MONTHS / SHORT_MONTHS constants", () => {
  it("has 12 months in long form, 1-indexed by value", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toEqual({ value: 1, label: "January" });
    expect(MONTHS[11]).toEqual({ value: 12, label: "December" });
  });

  it("has 12 short month labels aligned with MONTHS", () => {
    expect(SHORT_MONTHS).toHaveLength(12);
    expect(SHORT_MONTHS[0]).toBe("Jan");
    expect(SHORT_MONTHS[11]).toBe("Dec");
  });
});

describe("getConsecutiveMonths", () => {
  it("returns a single month for count=1", () => {
    expect(getConsecutiveMonths(5, 2026, 1)).toEqual([
      { month: 5, year: 2026, label: "May 2026" },
    ]);
  });

  it("returns no months when count=0", () => {
    expect(getConsecutiveMonths(1, 2026, 0)).toEqual([]);
  });

  it("walks consecutive months without crossing a year boundary", () => {
    const months = getConsecutiveMonths(3, 2026, 3);
    expect(months).toEqual([
      { month: 3, year: 2026, label: "March 2026" },
      { month: 4, year: 2026, label: "April 2026" },
      { month: 5, year: 2026, label: "May 2026" },
    ]);
  });

  it("rolls December over into the next January and bumps the year", () => {
    const months = getConsecutiveMonths(11, 2026, 4);
    expect(months).toEqual([
      { month: 11, year: 2026, label: "November 2026" },
      { month: 12, year: 2026, label: "December 2026" },
      { month: 1, year: 2027, label: "January 2027" },
      { month: 2, year: 2027, label: "February 2027" },
    ]);
  });

  it("handles a full 12-month forecast starting mid-year", () => {
    const months = getConsecutiveMonths(7, 2026, 12);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ month: 7, year: 2026, label: "July 2026" });
    expect(months[5]).toEqual({ month: 12, year: 2026, label: "December 2026" });
    expect(months[6]).toEqual({ month: 1, year: 2027, label: "January 2027" });
    expect(months[11]).toEqual({ month: 6, year: 2027, label: "June 2027" });
  });
});
