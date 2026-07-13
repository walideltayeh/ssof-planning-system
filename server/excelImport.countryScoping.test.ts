import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
//
// This file guards the country-scoping guarantee in `server/excelImport.ts`.
//
// The Excel import previously wrote one country's uploaded numbers against
// ANOTHER country's calendar months / product rows, because some period
// labels ("Apr 25") and SKU names ("Double Apple") are shared across
// countries. The fix scopes both the SKU map (`resolveSkuMap`) and the period
// map (`resolvePeriodMap`) to the target country via `db.getSkusForCountry` /
// `db.getPeriodsForCountry`. A regression that reverted either of those to the
// global getters (`getAllSkus` / `getAllPeriods`) would silently corrupt data.
//
// To catch that, we seed TWO countries (Lebanon + Syria) that deliberately
// share the same period label and SKU name but use disjoint ID spaces. We run
// an import for one country and assert that EVERY written row references only
// that country's period IDs and SKU IDs — never the other country's.
//
// We mock the entire `./db` module so the importers run end-to-end against an
// in-memory ExcelJS workbook without touching a real database, and we inspect
// the records handed to each `db.bulkUpsert*` call.

interface SeedSku {
  id: number;
  name: string;
  weight: string;
  packagingType: string;
  isActive: boolean;
}
interface SeedPeriod {
  id: number;
  label: string;
}

// Disjoint ID spaces per country. Shared name ("Double Apple") and shared
// period label ("Apr 25") are the trap: a global (un-scoped) lookup would
// resolve them to whichever country happened to win the last-write.
const SEED: Record<string, { skus: SeedSku[]; periods: SeedPeriod[] }> = {
  Lebanon: {
    skus: [
      { id: 101, name: "Double Apple", weight: "250g", packagingType: "New", isActive: true },
    ],
    periods: [{ id: 201, label: "Apr 25" }],
  },
  Syria: {
    skus: [
      { id: 301, name: "Double Apple", weight: "250g", packagingType: "New", isActive: true },
    ],
    periods: [{ id: 401, label: "Apr 25" }],
  },
};

vi.mock("./db", () => {
  return {
    logAudit: vi.fn(async () => undefined),
    getAllSkus: vi.fn(async () => {
      // If a regression points the importer back at the global getter, return
      // BOTH countries' SKUs so the leak (foreign IDs) actually surfaces.
      return [...SEED.Lebanon.skus, ...SEED.Syria.skus].map((s) => ({
        ...s,
        country: s.id < 300 ? "Lebanon" : "Syria",
      }));
    }),
    getSkusForCountry: vi.fn(async (country: string) => SEED[country]?.skus ?? []),
    getAllPeriods: vi.fn(async () => {
      return [...SEED.Lebanon.periods, ...SEED.Syria.periods].map((p) => ({
        ...p,
        country: p.id < 300 ? "Lebanon" : "Syria",
      }));
    }),
    getPeriodsForCountry: vi.fn(async (country: string) => SEED[country]?.periods ?? []),
    bulkUpsertForecast: vi.fn(async () => undefined),
    bulkUpsertIms: vi.fn(async () => undefined),
    bulkUpsertShipment: vi.fn(async () => undefined),
    bulkUpsertArrival: vi.fn(async () => undefined),
    bulkUpsertPlanningFgPartial: vi.fn(async () => undefined),
    bulkUpsertActualProduction: vi.fn(async () => undefined),
  };
});

// Import AFTER vi.mock so the importers pick up the mocked db helpers.
const {
  importForecastSheet,
  importImsSheet,
  importShipmentSheet,
  importArrivalSheet,
  importPlanningFgSheet,
} = await import("./excelImport");
const dbModule = await import("./db");

const bulkMocks = {
  forecast: vi.mocked(dbModule.bulkUpsertForecast),
  ims: vi.mocked(dbModule.bulkUpsertIms),
  shipment: vi.mocked(dbModule.bulkUpsertShipment),
  arrival: vi.mocked(dbModule.bulkUpsertArrival),
  planningFg: vi.mocked(dbModule.bulkUpsertPlanningFgPartial),
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Workbook fixtures (with real data rows for "Double Apple" / "Apr 25")
// ---------------------------------------------------------------------------

async function workbookBuffer(
  build: (wb: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

function buildForecastBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("Forecast");
    ws.addRow(["SKU Name", "Apr 25"]);
    ws.addRow(["Double Apple", 100]);
  });
}

function buildImsBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("IMS vs FRCST");
    ws.addRow(["SKU Name", "Apr 25"]);
    ws.addRow(["Double Apple", 80]);
  });
}

function buildShipmentBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("Shipment (Production)");
    ws.addRow(["SKU Name", "Apr 25", "", "", ""]);
    ws.addRow(["", "w1", "w2", "w3", "w4"]);
    ws.addRow(["Double Apple", 10, 20, 30, 40]);
  });
}

function buildArrivalBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("Arrival to Regie");
    ws.addRow(["SKU Name", "Apr 25", "", "", ""]);
    ws.addRow(["", "w1", "w2", "w3", "w4"]);
    ws.addRow(["Double Apple", 11, 21, 31, 41]);
  });
}

function buildPlanningFgBuffer(country: string): Promise<Buffer> {
  // Layout differs by template: Lebanon keeps the SKU name in col 2 with row
  // labels in col 3; the intl template (Syria/Libya/KSA) keeps the SKU name in
  // col 1 with row labels in col 2.
  if (country === "Lebanon") {
    return workbookBuffer((wb) => {
      const ws = wb.addWorksheet("Planning FG 250g");
      ws.addRow(["", "SKU Name", "Row", "Apr 25"]);
      ws.addRow(["", "Double Apple", "Opening stock", 50]);
      ws.addRow(["", "", "Adjustments", 5]);
    });
  }
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("Planning FG 250g");
    ws.addRow(["SKU Name", "Row", "Apr 25"]);
    ws.addRow(["Double Apple", "Opening stock", 50]);
    ws.addRow(["", "Adjustments", 5]);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type WrittenRow = { skuId: number; periodId: number };

/** Gather every (skuId, periodId) pair written across all bulkUpsert calls. */
function collectWrittenRows(): WrittenRow[] {
  const rows: WrittenRow[] = [];
  for (const mock of Object.values(bulkMocks)) {
    for (const call of mock.mock.calls) {
      const records = call[0] as WrittenRow[];
      for (const rec of records) {
        rows.push({ skuId: rec.skuId, periodId: rec.periodId });
      }
    }
  }
  return rows;
}

/**
 * Assert that every written row references ONLY the target country's IDs and
 * never the foreign country's — the post-import cross-country leak detector
 * called for in the task.
 */
function assertScopedTo(target: string, foreign: string) {
  const ownSkuIds = new Set(SEED[target].skus.map((s) => s.id));
  const ownPeriodIds = new Set(SEED[target].periods.map((p) => p.id));
  const foreignSkuIds = new Set(SEED[foreign].skus.map((s) => s.id));
  const foreignPeriodIds = new Set(SEED[foreign].periods.map((p) => p.id));

  const rows = collectWrittenRows();
  // Sanity: the import must have written something, otherwise the test would
  // pass vacuously even if scoping were broken.
  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    expect(ownSkuIds.has(row.skuId)).toBe(true);
    expect(ownPeriodIds.has(row.periodId)).toBe(true);
    expect(foreignSkuIds.has(row.skuId)).toBe(false);
    expect(foreignPeriodIds.has(row.periodId)).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("excelImport country scoping (no cross-country data corruption)", () => {
  const sheets: {
    name: string;
    run: (country: string) => Promise<unknown>;
  }[] = [
    { name: "forecast", run: async (c) => importForecastSheet(await buildForecastBuffer(), c, "tester") },
    { name: "ims", run: async (c) => importImsSheet(await buildImsBuffer(), c, "tester") },
    { name: "shipment", run: async (c) => importShipmentSheet(await buildShipmentBuffer(), c, "tester") },
    { name: "arrival", run: async (c) => importArrivalSheet(await buildArrivalBuffer(), c, "tester") },
    { name: "planning-fg", run: async (c) => importPlanningFgSheet(await buildPlanningFgBuffer(c), "250g", c, "tester") },
  ];

  for (const sheet of sheets) {
    it(`${sheet.name}: a Lebanon import writes only Lebanon IDs`, async () => {
      await sheet.run("Lebanon");
      assertScopedTo("Lebanon", "Syria");
    });

    it(`${sheet.name}: a Syria import writes only Syria IDs`, async () => {
      await sheet.run("Syria");
      assertScopedTo("Syria", "Lebanon");
    });

    it(`${sheet.name}: resolves SKUs/periods via the country-scoped getters, not the global ones`, async () => {
      await sheet.run("Lebanon");
      // The scoped getters must be consulted for the target country...
      expect(dbModule.getSkusForCountry).toHaveBeenCalledWith("Lebanon");
      expect(dbModule.getPeriodsForCountry).toHaveBeenCalledWith("Lebanon");
      // ...and the global, country-mixing getters must NOT be used (using them
      // is exactly how the original corruption bug crept in).
      expect(dbModule.getAllSkus).not.toHaveBeenCalled();
      expect(dbModule.getAllPeriods).not.toHaveBeenCalled();
    });
  }

  it("forecast: importing the SAME workbook for two countries lands rows in disjoint ID spaces", async () => {
    // Same uploaded file ("Double Apple" / "Apr 25"), two destinations. The
    // rows must never collide on IDs — proving the label/name overlap does not
    // leak across countries.
    await importForecastSheet(await buildForecastBuffer(), "Lebanon", "tester");
    const lebanonRows = collectWrittenRows();
    expect(lebanonRows.every((r) => r.skuId === 101 && r.periodId === 201)).toBe(true);

    vi.clearAllMocks();

    await importForecastSheet(await buildForecastBuffer(), "Syria", "tester");
    const syriaRows = collectWrittenRows();
    expect(syriaRows.every((r) => r.skuId === 301 && r.periodId === 401)).toBe(true);
  });
});
