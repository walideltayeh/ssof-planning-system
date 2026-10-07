import type { OrderedSection } from "./sections";

export const PERFORMANCE_TABS = [
  { id: "summary", label: "Summary", sectionIds: ["runningRate", "outlook", "executive", "changes"] },
  { id: "demand", label: "Demand", sectionIds: ["demand", "portfolio", "market"] },
  { id: "supply", label: "Supply & Stock", sectionIds: ["flow", "supply", "stockSituation", "inventory", "forward", "syriaReconciliation"] },
  { id: "quality", label: "Quality & Risk", sectionIds: ["quality", "anomalies", "confidence"] },
  { id: "value", label: "Value", sectionIds: ["commercial"] },
] as const;

export type PerformanceTabId = (typeof PERFORMANCE_TABS)[number]["id"];

export function sectionsForTab(sections: OrderedSection[], tabId: PerformanceTabId) {
  const ids = PERFORMANCE_TABS.find((tab) => tab.id === tabId)?.sectionIds ?? [];
  const byId = new Map(sections.map((section) => [section.id, section]));
  return ids.flatMap((id) => {
    const section = byId.get(id);
    return section ? [section] : [];
  });
}

/** Slide/PDF content is always the complete presenter order, independent of the selected screen tab. */
export function sectionsForPrint(sections: OrderedSection[]) {
  return sections;
}

export function accessiblePerformanceCountries(
  user: { isOwner: boolean; countries: string[] } | null | undefined,
  allCountries: readonly string[],
  canAccessCountry: (country: string) => boolean,
) {
  if (!user) return [];
  return allCountries.filter((country) => (user.isOwner || user.countries.includes(country)) && canAccessCountry(country));
}

export function performanceTabStorageKey(userId: number | string) {
  return `ssof-performance-tab:${userId}`;
}

export function getInitialPerformanceTab(userId: number | string | null | undefined, storage?: Pick<Storage, "getItem">): PerformanceTabId {
  if (userId === null || userId === undefined || !storage) return "summary";
  try {
    const saved = storage.getItem(performanceTabStorageKey(userId));
    return PERFORMANCE_TABS.some((tab) => tab.id === saved) ? saved as PerformanceTabId : "summary";
  } catch {
    return "summary";
  }
}

export function rememberPerformanceTab(userId: number | string | null | undefined, tabId: PerformanceTabId, storage?: Pick<Storage, "setItem">) {
  if (userId === null || userId === undefined || !storage) return;
  try {
    storage.setItem(performanceTabStorageKey(userId), tabId);
  } catch {
    // Storage can be unavailable in private browsing; tabs remain usable.
  }
}
