import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock the db module
vi.mock("./db", () => ({
  getFullPlanningData: vi.fn(),
}));

import { generateExcelBuffer } from "./excelExport";
import * as db from "./db";

const mockSkus = [
  { id: 1, name: "SKU A 1kg", weight: "1kg", category: "Core", isExcludedFromTotal: false },
  { id: 2, name: "SKU B 250g", weight: "250g", category: "Core", isExcludedFromTotal: false },
  { id: 3, name: "SKU C 50g", weight: "50g", category: "NPI", isExcludedFromTotal: false },
  { id: 4, name: "SKU D 50g Excluded", weight: "50g", category: "NPI", isExcludedFromTotal: true },
];

const mockPeriods = [
  { id: 1, year: 2025, month: 1, label: "Jan 25", sortOrder: 0 },
  { id: 2, year: 2025, month: 2, label: "Feb 25", sortOrder: 1 },
  { id: 3, year: 2025, month: 11, label: "Nov 25", sortOrder: 10 },
  { id: 4, year: 2025, month: 12, label: "Dec 25", sortOrder: 11 },
  { id: 5, year: 2026, month: 1, label: "Jan 26", sortOrder: 12 },
  { id: 6, year: 2026, month: 2, label: "Feb 26", sortOrder: 13 },
  { id: 7, year: 2026, month: 3, label: "Mar 26", sortOrder: 14 },
];

const mockForecast = mockSkus.flatMap(sku =>
  mockPeriods.map(p => ({ skuId: sku.id, periodId: p.id, value: "100" }))
);

const mockIms = mockSkus.flatMap(sku =>
  mockPeriods.map(p => ({ skuId: sku.id, periodId: p.id, value: "90", isActual: p.year === 2025 }))
);

const mockShipment = mockSkus.flatMap(sku =>
  mockPeriods.map(p => ({ skuId: sku.id, periodId: p.id, week1: "25", week2: "30", week3: "35", week4: "40" }))
);

const mockArrival = mockSkus.flatMap(sku =>
  mockPeriods.map(p => ({ skuId: sku.id, periodId: p.id, week1: "20", week2: "25", week3: "30", week4: "35" }))
);

const mockPlanningFg = mockSkus.flatMap(sku =>
  mockPeriods.map(p => ({ skuId: sku.id, periodId: p.id, openingStock: "500", adjustments: "0", invoiced: "0", arrivals: "100" }))
);

let wb: any;

describe("Excel Export", () => {
  beforeAll(async () => {
    (db.getFullPlanningData as any).mockResolvedValue({
      skus: mockSkus,
      periods: mockPeriods,
      forecast: mockForecast,
      ims: mockIms,
      shipment: mockShipment,
      arrival: mockArrival,
      planningFg: mockPlanningFg,
    });
    const ExcelJS = await import("exceljs");
    const buffer = await generateExcelBuffer();
    wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
  });

  it("should generate a valid Excel buffer", async () => {
    const buffer = await generateExcelBuffer();
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it("should contain all expected sheets", () => {
    const sheetNames = wb.worksheets.map((ws: any) => ws.name);
    expect(sheetNames).toContain("Navigation");
    expect(sheetNames).toContain("Dashboard");
    expect(sheetNames).toContain("Forecast");
    expect(sheetNames).toContain("IMS vs FRCST");
    expect(sheetNames).toContain("Shipment (Production)");
    expect(sheetNames).toContain("Arrival to Regie");
    expect(sheetNames).toContain("Planning FG 50g");
    expect(sheetNames).toContain("Planning FG 250g");
    expect(sheetNames).toContain("Planning FG 1kg");
  });

  it("should have navigation links to all sheets", () => {
    const navSheet = wb.getWorksheet("Navigation");
    let linkCount = 0;
    navSheet!.eachRow((row: any) => {
      row.eachCell((cell: any) => { if (cell.hyperlink) linkCount++; });
    });
    expect(linkCount).toBeGreaterThan(0);
  });

  it("should have dashboard KPIs", () => {
    const dashboard = wb.getWorksheet("Dashboard");
    const totalSkusCell = dashboard!.getCell(4, 1);
    expect(totalSkusCell.value).toBe(4);
  });

  // ===== IMS vs FRCST cross-sheet formulas =====
  it("IMS vs FRCST: Forecast row should reference Forecast sheet", () => {
    const imsSheet = wb.getWorksheet("IMS vs FRCST");
    // First SKU's Forecast row (row 2), first data column (col 5)
    const cell = imsSheet!.getCell(2, 5);
    const val = cell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("'Forecast'!");
  });

  it("IMS vs FRCST: Variance row should be IMS - Forecast formula", () => {
    const imsSheet = wb.getWorksheet("IMS vs FRCST");
    // Variance is row 4 (after Forecast=2, IMS=3)
    const cell = imsSheet!.getCell(4, 5);
    const val = cell.value;
    expect(typeof val).toBe("object");
    const formula = (val as any).formula;
    expect(formula).toContain("-");
    expect(formula).toContain("3"); // IMS row
    expect(formula).toContain("2"); // Forecast row
  });

  it("IMS vs FRCST: Subtotal should use SUM formula", () => {
    const imsSheet = wb.getWorksheet("IMS vs FRCST");
    let subtotalFound = false;
    imsSheet!.eachRow((row: any, rowNum: number) => {
      const c3 = row.getCell(3).value;
      if (c3 && typeof c3 === "string" && c3.includes("Subtotal") && !subtotalFound) {
        const c5 = row.getCell(5).value;
        if (typeof c5 === "object" && c5 !== null && "formula" in c5) {
          expect((c5 as any).formula).toContain("+");
          subtotalFound = true;
        }
      }
    });
    expect(subtotalFound).toBe(true);
  });

  // ===== Shipment formulas =====
  it("Shipment: Total column should be SUM(W1:W4)", () => {
    const shipment = wb.getWorksheet("Shipment (Production)");
    const totalCell = shipment!.getCell(3, 8); // row 3, col 8 = Total for first month
    const val = totalCell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("SUM");
  });

  // ===== Arrival cross-sheet formulas =====
  it("Arrival: Feb 26 W1-W4 should reference Shipment sheet", () => {
    const arrival = wb.getWorksheet("Arrival to Regie");
    let hasShipmentRef = false;
    arrival!.getRow(3).eachCell((cell: any) => {
      const val = cell.value;
      if (typeof val === "object" && val !== null && "formula" in val) {
        if ((val as any).formula.includes("Shipment")) hasShipmentRef = true;
      }
    });
    expect(hasShipmentRef).toBe(true);
  });

  it("Arrival: Total column should be SUM(W1:W4)", () => {
    const arrival = wb.getWorksheet("Arrival to Regie");
    // First month Total = col 8
    const totalCell = arrival!.getCell(3, 8);
    const val = totalCell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("SUM");
  });

  // ===== Planning FG cross-sheet formulas =====
  it("Planning FG: IMS row should reference IMS vs FRCST sheet", () => {
    const planning = wb.getWorksheet("Planning FG 1kg");
    // IMS is row 4 (Opening=2, Adjustments=3, IMS=4)
    const imsCell = planning!.getCell(4, 4); // first data col
    const val = imsCell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("'IMS vs FRCST'!");
  });

  it("Planning FG: Invoiced row should reference Shipment sheet", () => {
    const planning = wb.getWorksheet("Planning FG 1kg");
    // Invoiced is row 5
    const invCell = planning!.getCell(5, 4);
    const val = invCell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("'Shipment (Production)'!");
  });

  it("Planning FG: Arrivals row should reference Arrival to Regie sheet", () => {
    const planning = wb.getWorksheet("Planning FG 1kg");
    // Arrivals is row 6
    const arrCell = planning!.getCell(6, 4);
    const val = arrCell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("'Arrival to Regie'!");
  });

  it("Planning FG: Closing Stock formula should be Opening + Adj + Arrivals - IMS", () => {
    const planning = wb.getWorksheet("Planning FG 1kg");
    const csLabel = planning!.getCell(7, 3).value;
    expect(csLabel).toBe("Closing Stock");
    const csCell = planning!.getCell(7, 4);
    const val = csCell.value;
    expect(typeof val).toBe("object");
    const formula = (val as any).formula;
    expect(formula).toContain("+");
    expect(formula).toContain("-");
  });

  it("Planning FG: Opening Stock should reference previous Closing Stock", () => {
    const planning = wb.getWorksheet("Planning FG 1kg");
    // Second period's Opening Stock (col 5) should reference first period's Closing Stock
    const osCell = planning!.getCell(2, 5);
    const val = osCell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("7"); // Closing Stock row
  });

  it("Planning FG: Weeks formula should use IF and AVERAGE", () => {
    const planning = wb.getWorksheet("Planning FG 1kg");
    const wkLabel = planning!.getCell(8, 3).value;
    expect(wkLabel).toBe("Closing Stock - Weeks");
    const wkCell = planning!.getCell(8, 4);
    const val = wkCell.value;
    expect(typeof val).toBe("object");
    expect((val as any).formula).toContain("IF");
    expect((val as any).formula).toContain("4.3");
  });

  it("Planning FG: Weeks cells should have conditional formatting fills", () => {
    const planning = wb.getWorksheet("Planning FG 1kg");
    const wkCell = planning!.getCell(8, 4);
    expect(wkCell.fill).toBeDefined();
    if (wkCell.fill && wkCell.fill.type === "pattern") {
      expect(wkCell.fill.fgColor).toBeDefined();
    }
  });

  // ===== Structural tests =====
  it("should have frozen panes on data sheets", () => {
    const forecast = wb.getWorksheet("Forecast");
    expect(forecast!.views.length).toBeGreaterThan(0);
    expect(forecast!.views[0].state).toBe("frozen");
  });

  it("should have back-to-navigation links on data sheets", () => {
    const forecast = wb.getWorksheet("Forecast");
    let hasBackLink = false;
    forecast!.eachRow((row: any) => {
      row.eachCell((cell: any) => {
        if (cell.hyperlink && String(cell.hyperlink).includes("Navigation")) hasBackLink = true;
      });
    });
    expect(hasBackLink).toBe(true);
  });
});
