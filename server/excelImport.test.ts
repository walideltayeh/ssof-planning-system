import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
//
// These tests pin down a security guarantee one layer deeper than
// `server/spreadsheetUpload.test.ts`. That sibling file proves the HTTP
// route forwards the session-derived username (never `?username=`) into
// `handleImportSheet`. This file proves that every per-sheet importer in
// `server/excelImport.ts` actually writes that exact username into the
// `audit_trail` table — i.e. nobody substitutes `"System"`, a hard-coded
// label, or some other field downstream.
//
// We mock the entire `./db` module so the importers run end-to-end against
// an in-memory ExcelJS workbook without touching a real database, and we
// inspect the `db.logAudit({ username, ... })` call that each importer
// makes right before it returns.
vi.mock("./db", () => {
  return {
    logAudit: vi.fn(async () => undefined),
    getAllSkus: vi.fn(async () => []),
    getSkusForCountry: vi.fn(async () => []),
    getAllPeriods: vi.fn(async () => []),
    getPeriodsForCountry: vi.fn(async () => []),
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
  importActualProductionSheet,
} = await import("./excelImport");
const dbModule = await import("./db");

const logAuditMock = vi.mocked(dbModule.logAudit);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Workbook fixtures
// ---------------------------------------------------------------------------
//
// Each importer parses a slightly different sheet shape. The fixtures below
// are the smallest valid workbooks that let each importer find its header
// row (and, for shipment/arrival, the W1/W2/W3/W4 sub-headers) and reach
// the `db.logAudit` call. They intentionally contain no SKU rows — we are
// not testing import correctness here, only the audit username plumbing.

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
    ws.addRow(["SKU Name", "Jan 25"]);
  });
}

function buildImsBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("IMS vs FRCST");
    ws.addRow(["SKU Name", "Jan 25"]);
  });
}

function buildShipmentBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("Shipment (Production)");
    // Row 1: month period headers; Row 2: W1..W4 sub-headers.
    ws.addRow(["SKU Name", "Jan 25", "", "", ""]);
    ws.addRow(["", "w1", "w2", "w3", "w4"]);
  });
}

function buildArrivalBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("Arrival to Regie");
    ws.addRow(["SKU Name", "Jan 25", "", "", ""]);
    ws.addRow(["", "w1", "w2", "w3", "w4"]);
  });
}

function buildPlanningFgBuffer(weight: string): Promise<Buffer> {
  // Lebanon layout: skuNameCol = 2, rowLabelCol = 3, period columns follow.
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet(`Planning FG ${weight}`);
    ws.addRow(["", "SKU Name", "Row", "Jan 25"]);
  });
}

function buildActualProductionBuffer(): Promise<Buffer> {
  return workbookBuffer((wb) => {
    const ws = wb.addWorksheet("Forecast vs Actual");
    ws.addRow(["SKU Name", "Jan 25"]);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("excelImport audit-trail username forwarding", () => {
  it("importForecastSheet logs the caller-supplied username", async () => {
    const buf = await buildForecastBuffer();

    await importForecastSheet(buf, "Lebanon", "alice-forecast");

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const entry = logAuditMock.mock.calls[0][0];
    expect(entry.username).toBe("alice-forecast");
    // Guard against a future regression where some importer hard-codes a
    // service account name into the audit row.
    expect(entry.username).not.toBe("System");
    expect(entry.sheet).toBe("Forecast");
  });

  it("importImsSheet logs the caller-supplied username", async () => {
    const buf = await buildImsBuffer();

    await importImsSheet(buf, "Lebanon", "bob-ims");

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const entry = logAuditMock.mock.calls[0][0];
    expect(entry.username).toBe("bob-ims");
    expect(entry.username).not.toBe("System");
    expect(entry.sheet).toBe("IMS");
  });

  it("importShipmentSheet logs the caller-supplied username", async () => {
    const buf = await buildShipmentBuffer();

    await importShipmentSheet(buf, "Lebanon", "carol-shipment");

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const entry = logAuditMock.mock.calls[0][0];
    expect(entry.username).toBe("carol-shipment");
    expect(entry.username).not.toBe("System");
    expect(entry.sheet).toBe("Shipment");
  });

  it("importArrivalSheet logs the caller-supplied username", async () => {
    const buf = await buildArrivalBuffer();

    await importArrivalSheet(buf, "Lebanon", "dave-arrival");

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const entry = logAuditMock.mock.calls[0][0];
    expect(entry.username).toBe("dave-arrival");
    expect(entry.username).not.toBe("System");
    expect(entry.sheet).toBe("Arrival");
  });

  it("importPlanningFgSheet logs the caller-supplied username", async () => {
    const buf = await buildPlanningFgBuffer("250g");

    await importPlanningFgSheet(buf, "250g", "Lebanon", "eve-planning");

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const entry = logAuditMock.mock.calls[0][0];
    expect(entry.username).toBe("eve-planning");
    expect(entry.username).not.toBe("System");
    expect(entry.sheet).toBe("Planning FG 250g");
  });

  it("importActualProductionSheet logs the caller-supplied username", async () => {
    const buf = await buildActualProductionBuffer();

    await importActualProductionSheet(buf, "Lebanon", "frank-revised");

    expect(logAuditMock).toHaveBeenCalledTimes(1);
    const entry = logAuditMock.mock.calls[0][0];
    expect(entry.username).toBe("frank-revised");
    expect(entry.username).not.toBe("System");
    expect(entry.sheet).toBe("Forecast vs Actual");
  });

  it("preserves unusual but valid usernames verbatim across every importer", async () => {
    // A single end-to-end pass that proves no importer silently rewrites,
    // trims, lowercases, or substitutes the username it was handed.
    const oddName = "Renée O'Brien-99";

    await importForecastSheet(await buildForecastBuffer(), "Lebanon", oddName);
    await importImsSheet(await buildImsBuffer(), "Lebanon", oddName);
    await importShipmentSheet(await buildShipmentBuffer(), "Lebanon", oddName);
    await importArrivalSheet(await buildArrivalBuffer(), "Lebanon", oddName);
    await importPlanningFgSheet(
      await buildPlanningFgBuffer("250g"),
      "250g",
      "Lebanon",
      oddName,
    );
    await importActualProductionSheet(
      await buildActualProductionBuffer(),
      "Lebanon",
      oddName,
    );

    expect(logAuditMock).toHaveBeenCalledTimes(6);
    for (const call of logAuditMock.mock.calls) {
      expect(call[0].username).toBe(oddName);
    }
  });
});
