import { describe, expect, it } from "vitest";
import { arrangeSections, performanceSections } from "./sections";
import {
  accessiblePerformanceCountries,
  getInitialPerformanceTab,
  PERFORMANCE_TABS,
  performanceTabStorageKey,
  rememberPerformanceTab,
  sectionsForPrint,
  sectionsForTab,
} from "./navigation";

describe("country performance navigation", () => {
  const sections = arrangeSections(performanceSections.map((section) =>
    section.id === "syriaReconciliation" ? { ...section, available: undefined } : section,
  ), {
    order: ["confidence", "commercial", "runningRate", "demand", "flow", "syriaReconciliation", "outlook", "executive", "changes", "portfolio", "market", "supply", "stockSituation", "inventory", "forward", "quality", "anomalies"],
    hidden: ["portfolio"],
  });

  it("defaults to Summary and scopes remembered tabs to the authenticated user", () => {
    const store = new Map<string, string>([[performanceTabStorageKey(11), "supply"]]);
    const storage = { getItem: (key: string) => store.get(key) ?? null };
    expect(getInitialPerformanceTab(11, storage)).toBe("supply");
    expect(getInitialPerformanceTab(12, storage)).toBe("summary");
    expect(getInitialPerformanceTab(null, storage)).toBe("summary");
    expect(getInitialPerformanceTab(11, { getItem: () => "not-a-tab" })).toBe("summary");
    rememberPerformanceTab(12, "value", { setItem: (key, value) => store.set(key, value) });
    expect(store.get(performanceTabStorageKey(12))).toBe("value");
  });

  it("mounts only the selected working group, in its specified order", () => {
    expect(sectionsForTab(sections, "summary").map((section) => section.id))
      .toEqual(["runningRate", "outlook", "executive", "changes"]);
    expect(sectionsForTab(sections, "demand").map((section) => section.id))
      .toEqual(["demand", "portfolio", "market"]);
    expect(sectionsForTab(sections, "supply").map((section) => section.id))
      .toEqual(["flow", "supply", "stockSituation", "inventory", "forward", "syriaReconciliation"]);
    expect(sectionsForTab(sections, "quality").map((section) => section.id))
      .toEqual(["quality", "anomalies", "confidence"]);
    expect(sectionsForTab(sections, "value").map((section) => section.id)).toEqual(["commercial"]);
    expect(PERFORMANCE_TABS).toHaveLength(5);
  });

  it("keeps the complete saved slide and PDF order independent of selected tab, with no FOC section", () => {
    const printable = sectionsForPrint(sections);
    expect(printable.map((section) => section.id)).toEqual(sections.map((section) => section.id));
    expect(printable.map((section) => section.id)).toEqual([
      "confidence", "commercial", "runningRate", "demand", "flow", "syriaReconciliation", "outlook", "executive",
      "changes", "portfolio", "market", "supply", "stockSituation", "inventory", "forward", "quality", "anomalies",
    ]);
    expect(printable.some((section) => section.id === "foc")).toBe(false);
    expect(printable.find((section) => section.id === "portfolio")?.hiddenFromSlides).toBe(true);
  });

  it("retains Syria reconciliation only within the Supply & Stock group and keeps Deep Dive outside tab sections", () => {
    expect(sectionsForTab(sections, "supply").some((section) => section.id === "syriaReconciliation")).toBe(true);
    expect(PERFORMANCE_TABS.flatMap((tab) => tab.sectionIds)).not.toContain("deepDive");
    expect(PERFORMANCE_TABS.flatMap((tab) => tab.sectionIds)).not.toContain("foc");
  });

  it("limits All Countries access to assigned countries while allowing owner-wide access", () => {
    const all = ["Lebanon", "Syria", "Libya", "KSA"];
    expect(accessiblePerformanceCountries(
      { isOwner: false, countries: ["Lebanon", "Libya"] },
      all,
      (country) => country !== "Libya",
    )).toEqual(["Lebanon"]);
    expect(accessiblePerformanceCountries({ isOwner: true, countries: [] }, all, () => true)).toEqual(all);
    expect(accessiblePerformanceCountries(null, all, () => true)).toEqual([]);
  });
});
