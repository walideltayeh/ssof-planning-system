import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  getFullPlanningDataForCountry: vi.fn(),
  getActualProductionDataForCountry: vi.fn(),
}));
import * as db from "./db";
import { generateSingleSheetBufferForCountry } from "./excelExport";

const fixture = () => ({
  skus: [{ id: 1, name: "Libya Grape 50g", weight: "50g", category: "Core", packagingType: "New", isExcludedFromTotal: false }],
  periods: [
    { id: 10, year: 2026, month: 1, label: "Jan 2026", sortOrder: 1 },
    { id: 11, year: 2026, month: 2, label: "Feb 2026", sortOrder: 2 },
    { id: 12, year: 2026, month: 3, label: "Mar 2026", sortOrder: 3 },
  ],
  forecast: [{ skuId: 1, periodId: 10, value: "100" }, { skuId: 1, periodId: 11, value: "200" }],
  shipment: [{ skuId: 1, periodId: 10, week1: "80", week2: "0", week3: "0", week4: "0", arrivalOffsetValue: 2, arrivalOffsetUnit: "months", arrivalStatus: "Partially Cleared" }],
  actualProduction: [],
  clearanceEvents: [
    { skuId: 1, periodId: 10, clearedQty: "30", clearedDate: "2026-03-05", invoiceRef: "INV-A" },
    { skuId: 1, periodId: 10, clearedQty: "10", clearedDate: "2026-03-10", containerRef: "CONT-B" },
    { skuId: 1, periodId: 12, clearedQty: "5", clearedDate: "2026-04-01", notes: "Orphan event" },
  ],
  ims: [], arrival: [], planningFg: [],
});

beforeEach(() => {
  vi.mocked(db.getFullPlanningDataForCountry).mockResolvedValue(fixture() as never);
  vi.mocked(db.getActualProductionDataForCountry).mockResolvedValue([]);
});

async function exportWorkbook(country: "Libya" | "Syria" | "KSA" = "Libya", sheet = "arrival") {
  const buffer = await generateSingleSheetBufferForCountry(country, sheet);
  expect(buffer.subarray(0, 2).toString()).toBe("PK");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}

describe("international Arrival Excel download", () => {
  it("exports a readable Libya workbook with an Arrival worksheet", async () => {
    const wb = await exportWorkbook();
    expect(wb.worksheets.map((s) => s.name)).toEqual(["Arrival", "Clearance Events"]);
    expect(db.getFullPlanningDataForCountry).toHaveBeenCalledWith("Libya");
    const ws = wb.getWorksheet("Arrival")!;
    expect(ws.getCell("A2").value).toBe("Libya");
    expect(ws.getCell("B2").value).toBe("Libya Grape 50g");
    expect(ws.getCell("F2").value).toBe(100);
    expect(ws.getCell("G2").value).toBe(80);
    expect(ws.getCell("I2").value).toBe("2026-03-01");
    expect(ws.getCell("K2").value).toBe(40);
    expect(ws.getCell("L2").value).toBe(40);
    expect(ws.getCell("J3").value).toBe("Awaiting Actual");
    expect(ws.getCell("J4").value).toBe("No production — events");
    expect(wb.getWorksheet("Clearance Events")!.rowCount).toBe(4);
  });

  it("honors manual actual-production overrides", async () => {
    vi.mocked(db.getActualProductionDataForCountry).mockResolvedValue([{ skuId: 1, periodId: 10, value: "90" }] as never);
    const wb = await exportWorkbook();
    expect(wb.getWorksheet("Arrival")!.getCell("G2").value).toBe(90);
    expect(wb.getWorksheet("Arrival")!.getCell("L2").value).toBe(50);
  });

  it.each(["Libya", "Syria", "KSA"] as const)("keeps %s's empty export valid with column headers", async (country) => {
    vi.mocked(db.getFullPlanningDataForCountry).mockResolvedValue({ ...fixture(), skus: [], periods: [], shipment: [], forecast: [], clearanceEvents: [] } as never);
    const wb = await exportWorkbook(country);
    expect(wb.worksheets).toHaveLength(2);
    expect(wb.getWorksheet("Arrival")!.getCell("B1").value).toBe("SKU");
    expect(db.getFullPlanningDataForCountry).toHaveBeenCalledWith(country);
  });

  it("rejects unsupported sheet names rather than returning another empty workbook", async () => {
    await expect(exportWorkbook("Libya", "unknown")).rejects.toThrow(/worksheet/i);
  });
});
