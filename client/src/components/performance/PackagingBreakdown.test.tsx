import { describe, expect, it } from "vitest";
import { hasPackagingBreakdown, packagingCoverText, packagingMetricsForPrices } from "./PackagingBreakdown";
import type { PackagingAnalysis } from "@shared/performance/packaging";

const pack = (groups: PackagingAnalysis["groups"]): PackagingAnalysis => ({
  enabled: true, country: "Lebanon", asOf: "", groups, months: [], pairs: [], stalled: [], expiry: [], notes: [],
});

describe("packaging breakdown visibility", () => {
  it("hides a one-pack country even when active packaging analysis is enabled", () => {
    expect(hasPackagingBreakdown({ ...pack([]), enabled: false, groups: [
      { packaging: "Old", skuCount: 2, metrics: {} as PackagingAnalysis["groups"][number]["metrics"], monthsToClear: null, projectedClearMonth: null },
    ] })).toBe(false);
  });
  it("shows the split when both packaging groups are present", () => {
    expect(hasPackagingBreakdown(pack([
      { packaging: "Old", skuCount: 1, metrics: {} as PackagingAnalysis["groups"][number]["metrics"], monthsToClear: null, projectedClearMonth: null },
      { packaging: "New", skuCount: 1, metrics: {} as PackagingAnalysis["groups"][number]["metrics"], monthsToClear: null, projectedClearMonth: null },
    ]))).toBe(true);
  });
  it("keeps the enabled split visible with only the selected Old group and does not invent New", () => {
    const oldOnly = pack([
      { packaging: "Old", skuCount: 3, metrics: {} as PackagingAnalysis["groups"][number]["metrics"], monthsToClear: 2, projectedClearMonth: "May 2025" },
    ]);
    expect(hasPackagingBreakdown(oldOnly)).toBe(true);
    expect(oldOnly.groups.map((group) => group.packaging)).toEqual(["Old"]);
  });
  it("hides USD metrics when no price exists and marks zero-rate cover unknown", () => {
    expect(packagingMetricsForPrices(false)).not.toContain("selloutValue");
    expect(packagingMetricsForPrices(false)).not.toContain("stockValue");
    expect(packagingMetricsForPrices(true)).toContain("selloutValue");
    expect(packagingCoverText(0, 0, (value) => `${value} weeks`)).toBe("Unknown");
    expect(packagingCoverText(4, 2, (value) => `${value} weeks`)).toBe("4 weeks");
  });
});
