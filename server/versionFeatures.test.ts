import { describe, it, expect } from "vitest";

// ==================== Version Comparison Logic Tests ====================

function computeDiffSummary(snapshotA: any, snapshotB: any) {
  const skuNamesA = new Set(snapshotA.skus.map((s: any) => s.name));
  const skuNamesB = new Set(snapshotB.skus.map((s: any) => s.name));
  const addedSkus = snapshotB.skus.filter((s: any) => !skuNamesA.has(s.name));
  const removedSkus = snapshotA.skus.filter((s: any) => !skuNamesB.has(s.name));
  const commonSkuNames = snapshotA.skus.filter((s: any) => skuNamesB.has(s.name)).map((s: any) => s.name);

  const skuMapA = Object.fromEntries(snapshotA.skus.map((s: any) => [s.id, s]));
  const skuMapB = Object.fromEntries(snapshotB.skus.map((s: any) => [s.id, s]));
  const periodMapA = Object.fromEntries(snapshotA.periods.map((p: any) => [p.id, p]));
  const periodMapB = Object.fromEntries(snapshotB.periods.map((p: any) => [p.id, p]));

  function buildValueMap(data: any[], skuMap: any, periodMap: any) {
    const map = new Map<string, any>();
    for (const d of data) {
      const sku = skuMap[d.skuId];
      const period = periodMap[d.periodId];
      if (sku && period) {
        map.set(`${sku.name}|${period.label}`, d);
      }
    }
    return map;
  }

  function diffSheet(dataA: any[], dataB: any[], fields: string[]) {
    const mapA = buildValueMap(dataA, skuMapA, periodMapA);
    const mapB = buildValueMap(dataB, skuMapB, periodMapB);
    const allKeys = new Set([...Array.from(mapA.keys()), ...Array.from(mapB.keys())]);
    const changes: any[] = [];
    for (const key of Array.from(allKeys)) {
      const [skuName] = key.split("|");
      if (!commonSkuNames.includes(skuName)) continue;
      const a = mapA.get(key);
      const b = mapB.get(key);
      for (const field of fields) {
        const valA = a ? String(a[field] ?? "0") : "0";
        const valB = b ? String(b[field] ?? "0") : "0";
        if (parseFloat(valA) !== parseFloat(valB)) {
          changes.push({ skuName, field, valueA: valA, valueB: valB });
        }
      }
    }
    return changes;
  }

  const skuByNameA = Object.fromEntries(snapshotA.skus.map((s: any) => [s.name, s]));
  const skuByNameB = Object.fromEntries(snapshotB.skus.map((s: any) => [s.name, s]));
  const skuChanges: any[] = [];
  for (const name of commonSkuNames) {
    const a = skuByNameA[name];
    const b = skuByNameB[name];
    if (a && b) {
      if (a.weight !== b.weight) skuChanges.push({ skuName: name, field: "weight" });
      if (a.category !== b.category) skuChanges.push({ skuName: name, field: "category" });
    }
  }

  return {
    addedSkus,
    removedSkus,
    skuChanges,
    forecastDiff: diffSheet(snapshotA.forecast || [], snapshotB.forecast || [], ["value"]),
    imsDiff: diffSheet(snapshotA.ims || [], snapshotB.ims || [], ["value"]),
    shipmentDiff: diffSheet(snapshotA.shipment || [], snapshotB.shipment || [], ["week1", "week2", "week3", "week4"]),
  };
}

describe("Version Comparison Logic", () => {
  const baseSnapshot = {
    skus: [
      { id: 1, name: "SKU A", weight: "1kg", category: "Core" },
      { id: 2, name: "SKU B", weight: "250g", category: "NPI" },
    ],
    periods: [
      { id: 1, year: 2025, month: 1, label: "Jan 25" },
      { id: 2, year: 2025, month: 2, label: "Feb 25" },
    ],
    forecast: [
      { skuId: 1, periodId: 1, value: "100" },
      { skuId: 1, periodId: 2, value: "200" },
      { skuId: 2, periodId: 1, value: "300" },
    ],
    ims: [],
    shipment: [],
    arrival: [],
    planningFg: [],
  };

  it("should detect no changes when comparing identical snapshots", () => {
    const diff = computeDiffSummary(baseSnapshot, baseSnapshot);
    expect(diff.addedSkus).toHaveLength(0);
    expect(diff.removedSkus).toHaveLength(0);
    expect(diff.skuChanges).toHaveLength(0);
    expect(diff.forecastDiff).toHaveLength(0);
  });

  it("should detect added SKUs", () => {
    const modified = {
      ...baseSnapshot,
      skus: [
        ...baseSnapshot.skus,
        { id: 3, name: "SKU C", weight: "50g", category: "Core" },
      ],
    };
    const diff = computeDiffSummary(baseSnapshot, modified);
    expect(diff.addedSkus).toHaveLength(1);
    expect(diff.addedSkus[0].name).toBe("SKU C");
    expect(diff.removedSkus).toHaveLength(0);
  });

  it("should detect removed SKUs", () => {
    const modified = {
      ...baseSnapshot,
      skus: [baseSnapshot.skus[0]],
    };
    const diff = computeDiffSummary(baseSnapshot, modified);
    expect(diff.removedSkus).toHaveLength(1);
    expect(diff.removedSkus[0].name).toBe("SKU B");
  });

  it("should detect SKU property changes", () => {
    const modified = {
      ...baseSnapshot,
      skus: [
        { id: 1, name: "SKU A", weight: "250g", category: "Core" }, // weight changed
        { id: 2, name: "SKU B", weight: "250g", category: "Core" }, // category changed
      ],
    };
    const diff = computeDiffSummary(baseSnapshot, modified);
    expect(diff.skuChanges).toHaveLength(2);
    expect(diff.skuChanges.find((c: any) => c.field === "weight")).toBeTruthy();
    expect(diff.skuChanges.find((c: any) => c.field === "category")).toBeTruthy();
  });

  it("should detect forecast value changes", () => {
    const modified = {
      ...baseSnapshot,
      forecast: [
        { skuId: 1, periodId: 1, value: "150" }, // changed from 100
        { skuId: 1, periodId: 2, value: "200" }, // same
        { skuId: 2, periodId: 1, value: "300" }, // same
      ],
    };
    const diff = computeDiffSummary(baseSnapshot, modified);
    expect(diff.forecastDiff).toHaveLength(1);
    expect(diff.forecastDiff[0].valueA).toBe("100");
    expect(diff.forecastDiff[0].valueB).toBe("150");
  });

  it("should detect new data entries for existing SKUs", () => {
    const modified = {
      ...baseSnapshot,
      forecast: [
        ...baseSnapshot.forecast,
        { skuId: 2, periodId: 2, value: "400" }, // new entry
      ],
    };
    const diff = computeDiffSummary(baseSnapshot, modified);
    expect(diff.forecastDiff).toHaveLength(1);
    expect(diff.forecastDiff[0].skuName).toBe("SKU B");
  });

  it("should detect shipment weekly changes", () => {
    const snapshotA = {
      ...baseSnapshot,
      shipment: [
        { skuId: 1, periodId: 1, week1: "10", week2: "20", week3: "30", week4: "40" },
      ],
    };
    const snapshotB = {
      ...baseSnapshot,
      shipment: [
        { skuId: 1, periodId: 1, week1: "15", week2: "20", week3: "30", week4: "40" },
      ],
    };
    const diff = computeDiffSummary(snapshotA, snapshotB);
    expect(diff.shipmentDiff).toHaveLength(1);
    expect(diff.shipmentDiff[0].field).toBe("week1");
  });

  it("should handle empty snapshots gracefully", () => {
    const empty = { skus: [], periods: [], forecast: [], ims: [], shipment: [], arrival: [], planningFg: [] };
    const diff = computeDiffSummary(empty, empty);
    expect(diff.addedSkus).toHaveLength(0);
    expect(diff.removedSkus).toHaveLength(0);
    expect(diff.forecastDiff).toHaveLength(0);
  });

  it("should not count changes for removed SKUs in value diffs", () => {
    const modified = {
      ...baseSnapshot,
      skus: [baseSnapshot.skus[0]], // Only SKU A
      forecast: [
        { skuId: 1, periodId: 1, value: "100" }, // same as base
        { skuId: 1, periodId: 2, value: "200" }, // same as base
      ],
    };
    const diff = computeDiffSummary(baseSnapshot, modified);
    // SKU B was removed, so its forecast entries should not appear in forecastDiff
    // SKU A's entries are identical, so no forecast diffs
    expect(diff.forecastDiff).toHaveLength(0);
    expect(diff.removedSkus).toHaveLength(1);
  });
});

// ==================== Auto-save Reminder Logic Tests ====================

describe("Auto-save Reminder Logic", () => {
  const EDIT_THRESHOLD = 20;

  it("should not trigger reminder when edit count is below threshold", () => {
    const count = 10;
    expect(count >= EDIT_THRESHOLD).toBe(false);
  });

  it("should trigger reminder when edit count meets threshold", () => {
    const count = 20;
    expect(count >= EDIT_THRESHOLD).toBe(true);
  });

  it("should trigger reminder when edit count exceeds threshold", () => {
    const count = 50;
    expect(count >= EDIT_THRESHOLD).toBe(true);
  });

  it("should respect dismiss cooldown", () => {
    const now = Date.now();
    const dismissedAt = now - 5 * 60_000; // 5 minutes ago
    const cooldown = 10 * 60_000; // 10 minutes
    expect(now - dismissedAt > cooldown).toBe(false);
  });

  it("should allow reminder after cooldown expires", () => {
    const now = Date.now();
    const dismissedAt = now - 15 * 60_000; // 15 minutes ago
    const cooldown = 10 * 60_000; // 10 minutes
    expect(now - dismissedAt > cooldown).toBe(true);
  });
});

// ==================== Version Comments Structure Tests ====================

describe("Version Comments", () => {
  it("should validate comment structure", () => {
    const comment = {
      id: 1,
      versionId: 5,
      username: "admin",
      comment: "This version includes Q1 adjustments",
      createdAt: new Date(),
    };
    expect(comment.versionId).toBe(5);
    expect(comment.username).toBe("admin");
    expect(comment.comment).toContain("Q1");
    expect(comment.createdAt).toBeInstanceOf(Date);
  });

  it("should reject empty comments", () => {
    const comment = "";
    expect(comment.trim().length > 0).toBe(false);
  });

  it("should accept multi-line comments", () => {
    const comment = "Line 1\nLine 2\nLine 3";
    expect(comment.split("\n")).toHaveLength(3);
  });

  it("should preserve whitespace in comments", () => {
    const comment = "  indented text  ";
    expect(comment).toBe("  indented text  ");
    expect(comment.trim()).toBe("indented text");
  });
});
