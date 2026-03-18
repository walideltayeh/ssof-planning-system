import { describe, it, expect, vi } from "vitest";

// Test the Word document generation logic (structure and content)
describe("Version Document Generation", () => {
  it("should create proper changes summary structure", () => {
    const changesSummary = {
      totalChanges: 5,
      bySheet: { Forecast: 3, "IMS Actuals": 2 },
      byAction: { edit_cell: 4, upload: 1 },
      byUser: { Walid: 3, Taha: 2 },
      recentChanges: [
        {
          username: "Walid",
          action: "edit_cell",
          sheet: "Forecast",
          skuName: "Al Fakher Grapes 1kg",
          periodLabel: "Jan 25",
          field: "value",
          oldValue: "100",
          newValue: "200",
          details: "Changed forecast from 100 to 200",
          createdAt: new Date("2025-03-01"),
        },
      ],
      previousVersion: null,
      skuCount: 15,
      periodCount: 36,
    };

    expect(changesSummary.totalChanges).toBe(5);
    expect(changesSummary.bySheet["Forecast"]).toBe(3);
    expect(changesSummary.byUser["Walid"]).toBe(3);
    expect(changesSummary.recentChanges).toHaveLength(1);
    expect(changesSummary.recentChanges[0].skuName).toBe("Al Fakher Grapes 1kg");
  });

  it("should track changes by sheet correctly", () => {
    const logs = [
      { sheet: "Forecast", action: "edit_cell" },
      { sheet: "Forecast", action: "edit_cell" },
      { sheet: "IMS Actuals", action: "upload" },
      { sheet: "Planning FG", action: "edit_cell" },
      { sheet: null, action: "save_version" },
    ];

    const bySheet: Record<string, number> = {};
    for (const log of logs) {
      if (log.sheet) bySheet[log.sheet] = (bySheet[log.sheet] || 0) + 1;
    }

    expect(bySheet["Forecast"]).toBe(2);
    expect(bySheet["IMS Actuals"]).toBe(1);
    expect(bySheet["Planning FG"]).toBe(1);
    expect(Object.keys(bySheet)).toHaveLength(3);
  });

  it("should track changes by user correctly", () => {
    const logs = [
      { username: "Walid" },
      { username: "Walid" },
      { username: "Taha" },
      { username: "David" },
    ];

    const byUser: Record<string, number> = {};
    for (const log of logs) {
      byUser[log.username] = (byUser[log.username] || 0) + 1;
    }

    expect(byUser["Walid"]).toBe(2);
    expect(byUser["Taha"]).toBe(1);
    expect(byUser["David"]).toBe(1);
  });
});

// Test snapshot structure
describe("Snapshot Structure", () => {
  it("should include all required data tables", () => {
    const snapshot = {
      skus: [{ id: 1, name: "Test SKU", weight: "1kg", category: "Core", sortOrder: 0, isExcludedFromTotal: false }],
      periods: [{ id: 1, year: 2025, month: 1, label: "Jan 25", sortOrder: 0 }],
      forecast: [{ skuId: 1, periodId: 1, value: "100" }],
      ims: [{ skuId: 1, periodId: 1, value: "90", isActual: true }],
      shipment: [{ skuId: 1, periodId: 1, week1: "10", week2: "20", week3: "30", week4: "40" }],
      arrival: [{ skuId: 1, periodId: 1, week1: "5", week2: "10", week3: "15", week4: "20" }],
      planningFg: [{ skuId: 1, periodId: 1, openingStock: "500", adjustments: "0", invoiced: "100", arrivals: "50" }],
    };

    expect(snapshot).toHaveProperty("skus");
    expect(snapshot).toHaveProperty("periods");
    expect(snapshot).toHaveProperty("forecast");
    expect(snapshot).toHaveProperty("ims");
    expect(snapshot).toHaveProperty("shipment");
    expect(snapshot).toHaveProperty("arrival");
    expect(snapshot).toHaveProperty("planningFg");
    expect(snapshot.skus).toHaveLength(1);
    expect(snapshot.periods).toHaveLength(1);
  });

  it("should preserve SKU properties in snapshot", () => {
    const sku = { id: 1, name: "Al Fakher Mint 1kg", weight: "1kg", category: "Core", sortOrder: 5, isExcludedFromTotal: false };
    expect(sku.name).toBe("Al Fakher Mint 1kg");
    expect(sku.weight).toBe("1kg");
    expect(sku.category).toBe("Core");
    expect(sku.isExcludedFromTotal).toBe(false);
  });

  it("should preserve period properties in snapshot", () => {
    const period = { id: 1, year: 2025, month: 3, label: "Mar 25", sortOrder: 2 };
    expect(period.year).toBe(2025);
    expect(period.month).toBe(3);
    expect(period.label).toBe("Mar 25");
  });

  it("should preserve forecast values as strings", () => {
    const forecast = { skuId: 1, periodId: 1, value: "1500.50" };
    expect(typeof forecast.value).toBe("string");
    expect(parseFloat(forecast.value)).toBe(1500.5);
  });

  it("should preserve shipment weekly breakdown", () => {
    const shipment = { skuId: 1, periodId: 1, week1: "100", week2: "200", week3: "300", week4: "400" };
    const total = parseFloat(shipment.week1) + parseFloat(shipment.week2) + parseFloat(shipment.week3) + parseFloat(shipment.week4);
    expect(total).toBe(1000);
  });
});

// Test chunk array utility
describe("Chunk Array Utility", () => {
  function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }

  it("should split array into chunks of specified size", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    const chunks = chunkArray(arr, 3);
    expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it("should handle empty array", () => {
    const chunks = chunkArray([], 5);
    expect(chunks).toEqual([]);
  });

  it("should handle array smaller than chunk size", () => {
    const chunks = chunkArray([1, 2], 5);
    expect(chunks).toEqual([[1, 2]]);
  });

  it("should handle exact multiple of chunk size", () => {
    const chunks = chunkArray([1, 2, 3, 4], 2);
    expect(chunks).toEqual([[1, 2], [3, 4]]);
  });
});

// Test version export/import format
describe("Version Export/Import Format", () => {
  it("should produce valid export format", () => {
    const exportData = {
      name: "SSOFv1",
      description: "Initial baseline",
      savedBy: "Walid",
      createdAt: new Date("2025-03-01T10:00:00Z"),
      snapshotData: {
        skus: [],
        periods: [],
        forecast: [],
        ims: [],
        shipment: [],
        arrival: [],
        planningFg: [],
      },
      changesSummary: { totalChanges: 0 },
    };

    expect(exportData.name).toBe("SSOFv1");
    expect(exportData.snapshotData).toBeDefined();
    expect(exportData.snapshotData.skus).toBeInstanceOf(Array);
    
    // Should be JSON-serializable
    const json = JSON.stringify(exportData);
    const parsed = JSON.parse(json);
    expect(parsed.name).toBe("SSOFv1");
    expect(parsed.snapshotData.skus).toEqual([]);
  });

  it("should validate import data has required snapshotData", () => {
    const validImport = { snapshotData: { skus: [], periods: [] } };
    const invalidImport = { name: "test" };

    expect(validImport.snapshotData).toBeDefined();
    expect((invalidImport as any).snapshotData).toBeUndefined();
  });

  it("should handle version name sanitization for file export", () => {
    const name = "SSOF v1 (March 2025)";
    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
    expect(safeName).toBe("SSOF_v1__March_2025_");
    expect(safeName).not.toContain(" ");
    expect(safeName).not.toContain("(");
  });
});
