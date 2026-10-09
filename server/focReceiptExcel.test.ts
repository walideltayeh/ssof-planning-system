import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
vi.mock("./db", () => ({ getFullPlanningDataForCountry: vi.fn(), getActualProductionDataForCountry: vi.fn() }));
const db = await import("./db");
const { generateSingleSheetBufferForCountry } = await import("./excelExport");
let data: any;
describe("Syria FG quantities linked to Production, FOC and Arrival", () => {
  it.each(["50g", "250g", "1kg"])("exports linked production and all awaiting lines for %s without inflating stock", async weight => {
    data.skus[0].country = "Syria"; data.skus[0].weight = weight;
    data.periods.forEach((p: any) => { p.country = "Syria"; });
    data.forecast = [{ skuId: 1, periodId: 9, value: "1000" }];
    data.shipment = [{ skuId: 1, periodId: 9, week1: "800" }];
    data.arrival = [];
    data.clearanceEvents = [{ country: "Syria", skuId: 1, periodId: 9, clearedQty: "200", clearedDate: "2026-09-20" }];
    data.foc = [{ country: "Syria", skuId: 1, periodId: 9, value: "50", received: false,
      lines: [20, 30].map((quantityMC, id) => ({ id: String(id), quantityMC, received: false, source: "Recorded FOC",
        accType: "Export", salesManager: "", actor: "Test", recordedAt: "2026-09-01T00:00:00Z" })) }];
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await generateSingleSheetBufferForCountry("Syria", `planning-fg-${weight}`) as any);
    const ws = wb.worksheets[0];
    expect(row(ws, "Production").getCell(4).value).toBe(800);
    expect(row(ws, "FOC").getCell(4).value).toBeNull();
    expect(row(ws, "Full Production").getCell(4).value).toBe(800);
    expect(row(ws, "FOC awaiting receipt").getCell(4).value).toBe(50);
    expect(row(ws, "Arrivals / Orders").getCell(4).value).toBe(200);
    expect(row(ws, "Closing Stock").getCell(4).value).toBe(1190);
    expect(row(ws, "Stock Weeks").getCell(4).value).toBe(476);
    data.foc[0].lines[0].received = true;
    data.foc[0].lines[1].received = true;
    const received = new ExcelJS.Workbook();
    await received.xlsx.load(await generateSingleSheetBufferForCountry("Syria", `planning-fg-${weight}`) as any);
    expect(row(received.worksheets[0], "Production").getCell(4).value).toBe(800);
    expect(row(received.worksheets[0], "FOC").getCell(4).value).toBe(50);
    expect(row(received.worksheets[0], "Full Production").getCell(4).value).toBe(850);
    expect(row(received.worksheets[0], "Closing Stock").getCell(4).value).toBe(1190);
  });
});
beforeEach(() => {
  data = {
    skus: [{ id: 1, country: "Libya", name: "Mint", weight: "50g", isActive: true, isExcludedFromTotal: false }],
    periods: [9, 10].map(m => ({ id: m, country: "Libya", year: 2026, month: m, label: `${m}/2026`, sortOrder: m })),
    forecast: [], ims: [{ skuId: 1, periodId: 9, value: "10" }], shipment: [],
    arrival: [{ skuId: 1, periodId: 9, week1: "999" }], actualProduction: [],
    planningFg: [{ skuId: 1, periodId: 9, openingStock: "1000" }],
    clearanceEvents: [{ country: "Libya", skuId: 1, periodId: 9, clearedQty: "100", clearedDate: "2026-09-20" }],
    foc: [{ country: "Libya", skuId: 1, periodId: 9, value: "12.34", received: false }],
  };
  vi.mocked(db.getFullPlanningDataForCountry).mockImplementation(async () => structuredClone(data));
  vi.mocked(db.getActualProductionDataForCountry).mockResolvedValue([]);
});
async function sheet(includeFoc = true, unit: "MC" | "KG" | "Tons" = "MC") {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await generateSingleSheetBufferForCountry("Libya", "planning-fg-50g", includeFoc, unit) as any);
  return wb.worksheets[0];
}
function row(ws: ExcelJS.Worksheet, name: string): ExcelJS.Row {
  let found: ExcelJS.Row | undefined;
  ws.eachRow(r => { if (r.getCell(3).value === name) found = r; });
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}
describe("Planning FG receipt Excel parity", () => {
  it("uses authoritative clearance arrivals, keeps No out of stock, and exports awaiting separately", async () => {
    const ws = await sheet();
    expect(row(ws, "Arrivals / Orders").getCell(4).value).toBe(100);
    expect(row(ws, "Closing Stock").getCell(4).value).toBe(1090);
    expect(row(ws, "Closing Stock").getCell(5).value).toBe(1090);
    expect(row(ws, "FOC awaiting receipt").getCell(4).value).toBe(12.34);
    expect(row(ws, "FOC awaiting receipt").getCell(5).value).toBe("Not set");
  });
  it("lands Yes in its own month, excludes it when off, and No reverses exactly", async () => {
    data.foc[0].received = true;
    let ws = await sheet();
    expect(row(ws, "Arrivals / Orders").getCell(4).value).toBe(112.34);
    expect(row(ws, "Arrivals / Orders").getCell(5).value).toBeNull();
    expect(row(ws, "Closing Stock").getCell(5).value).toBe(1102.34);
    expect(row(ws, "FOC awaiting receipt").getCell(4).value).toBe(0);
    ws = await sheet(false);
    expect(row(ws, "Closing Stock").getCell(5).value).toBe(1090);
    expect(String(ws.getRow(1).getCell(1).value)).toContain("Excluding FOC");
    expect(ws.headerFooter.oddHeader).toContain("Excluding FOC");
    data.foc[0].received = false;
    expect(row(await sheet(), "Closing Stock").getCell(5).value).toBe(1090);
  });
  it.each([["KG", 6], ["Tons", 0.006]] as const)("exports quantities in %s but never converts cover weeks", async (unit, factor) => {
    data.foc[0].received = true;
    const ws = await sheet(true, unit);
    expect(row(ws, "Arrivals / Orders").getCell(4).value).toBeCloseTo(112.34 * factor, 8);
    expect(row(ws, "Arrivals / Orders").getCell(5).value).toBeNull();
    expect(row(ws, "Closing Stock").getCell(5).value).toBeCloseTo(1102.34 * factor, 8);
    expect(row(ws, "Stock Weeks").getCell(4).value).toBe(440.9);
    expect(ws.headerFooter.oddHeader).toContain(unit);
  });
  it("holds a duplicate, exports its warning, and does not add on top of existing clearance", async () => {
    data.foc[0].received = true;
    data.clearanceEvents.push({ country: "Libya", skuId: 1, periodId: 9, clearedQty: "12.34", clearedDate: "2026-09-21" });
    const ws = await sheet();
    expect(row(ws, "Arrivals / Orders").getCell(4).value).toBe(112.34);
    expect(row(ws, "Closing Stock").getCell(5).value).toBe(1102.34);
    const warnings: string[] = []; ws.eachRow(r => { warnings.push(String(r.getCell(1).value)); });
    expect(warnings.some(w => w.includes("Mint 50g") && w.includes("12.34 MC") && w.includes("not added"))).toBe(true);
  });
});
