import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildForecastFocSheet, isForecastFocSheet, parseForecastFocSheet, type ForecastSheetData, type ForecastUnit } from "./forecastFocWorkbook";
import { loadXlsxBuffer } from "./excelLoad";

function dataset(): ForecastSheetData {
  return { country: "Libya",
    skus: [
      { id: 1, name: "Mint", weight: "50g", packagingType: "Old", isActive: true, country: "Libya" },
      { id: 2, name: "Mint", weight: "50g", packagingType: "New", isActive: true, country: "Libya" },
      { id: 3, name: "Inactive", weight: "50g", packagingType: "New", isActive: false, country: "Libya" },
    ],
    periods: [{ id: 10, label: "Sep 26", year: 2026, month: 9, country: "Libya" }, { id: 11, label: "Oct 26", year: 2026, month: 10, country: "Libya" }],
    forecast: [{ skuId: 1, periodId: 10, value: "123.33" }, { skuId: 2, periodId: 10, value: "50" }],
    foc: [
      { country: "Libya", skuId: 1, periodId: 10, value: "12.33", received: true, receiptDecision: "separate", receiptReviewKey: "stable review evidence" },
      { country: "Libya", skuId: 1, periodId: 11, value: "0.00", received: false },
      { country: "Libya", skuId: 2, periodId: 10, value: null, received: false },
    ], arrival: [], clearanceEvents: [], planningFg: [] };
}
const parse = (ws: ExcelJS.Worksheet, ds = dataset(), country = "Libya") =>
  parseForecastFocSheet(ws, country, ds, 2, isForecastFocSheet(ws, 2).typeCol, new Map([[10, 5], [11, 6]]));
const make = (include = true, unit: ForecastUnit = "MC") => buildForecastFocSheet(new ExcelJS.Workbook(), dataset(), include, unit);
const row = (ws: ExcelJS.Worksheet, label: string, packaging = "Old") =>
  ws.getRows(1, ws.rowCount)!.find(r => r.getCell(1).value === "Mint" && r.getCell(3).value === packaging && r.getCell(4).value === label)!;

describe("paired Forecast Production workbook", () => {
  it.each(["MC", "KG", "Tons"] as const)("round-trips the serialized %s workbook, quantities and receipt metadata", async unit => {
    const wb = new ExcelJS.Workbook();
    buildForecastFocSheet(wb, dataset(), true, unit);
    const loaded = new ExcelJS.Workbook();
    await loadXlsxBuffer(loaded, Buffer.from(await wb.xlsx.writeBuffer()));
    const ws = loaded.worksheets[0], result = parse(ws);
    expect(isForecastFocSheet(ws, 2).paired).toBe(true);
    expect(result.unit).toBe(unit);
    expect(result.forecast.find(c => c.skuId === 1 && c.periodId === 10)?.value).toBe("123.33");
    expect(result.forecast.find(c => c.skuId === 2 && c.periodId === 10)?.value).toBe("50.00");
    expect(result.foc.find(c => c.skuId === 1 && c.periodId === 10)).toMatchObject({
      value: "12.33", received: true, receiptDecision: "separate", receiptReviewKey: "stable review evidence",
    });
    expect(result.foc.find(c => c.skuId === 1 && c.periodId === 11)?.value).toBe("0.00");
    expect(result.foc.find(c => c.skuId === 2 && c.periodId === 10)?.value).toBeNull();
    expect(result.foc.find(c => c.skuId === 2 && c.periodId === 11)?.value).toBeNull();
    expect(result.forecast.some(c => c.skuId === 3)).toBe(false);
    expect(result.foc.every(c => !("receivedDate" in c))).toBe(true);
    expect(ws.getRows(1, ws.rowCount)?.some(r => r.getCell(4).value === "FOC Received date")).toBe(false);
  });
  it("places the FOC quantity row directly below its ordered row", () => {
    const ws = make();
    expect(row(ws, "FOC").number).toBe(row(ws, "Ordered").number + 1);
    expect(row(ws, "FOC").getCell(5).fill).toMatchObject({ fgColor: { argb: "FFF0FDF4" } });
    expect(ws.getRows(1, ws.rowCount)?.some(r => r.getCell(1).value === "Inactive")).toBe(false);
  });
  it("labels combined basis and does not change receipt flags when FOC is excluded", () => {
    const on = make(), off = make(false);
    expect(row(on, "Combined (including planned FOC)").getCell(5).value).toBe(135.66);
    expect(row(off, "Combined (ordered only; FOC excluded)").getCell(5).value).toBe(123.33);
    expect(row(off, "FOC Received").getCell(5).value).toBe("Yes");
    expect(off.headerFooter.oddHeader).toContain("ordered only; FOC excluded");
    expect(row(on, "Combined (including planned FOC)", "New").getCell(5).value).toBe("Not set");
    expect(row(off, "Combined (ordered only; FOC excluded)", "New").getCell(5).value).toBe(50);
  });
  it("keeps paid and FOC values separate when editing the repeated rows", () => {
    const ws = make();
    row(ws, "FOC").getCell(5).value = 99;
    row(ws, "FOC Received").getCell(5).value = "No";
    const result = parse(ws);
    expect(result.forecast.find(c => c.skuId === 1 && c.periodId === 10)?.value).toBe("123.33");
    expect(result.foc.find(c => c.skuId === 1 && c.periodId === 10)).toMatchObject({ value: "99.00", received: false });
  });
  it("rejects a different workbook country before any writes", () => {
    expect(() => parse(make(), dataset(), "Syria")).toThrow("Workbook country");
  });
  it("rejects an unknown exact packaging rather than falling back", () => {
    const ws = make();
    row(ws, "FOC").getCell(3).value = "Unrecognized";
    expect(() => parse(ws)).toThrow("No active exact Libya SKU");
  });
  it("rejects an inactive SKU even when it is in the target country", () => {
    const ws = make();
    const ds = dataset(); ds.skus[0].isActive = false;
    expect(() => parse(ws, ds)).toThrow("No active exact Libya SKU");
  });
  it("rejects incomplete pairs, duplicate rows and invalid receipt flags", () => {
    const ws = make(), focRow = row(ws, "FOC");
    ws.addRow(focRow.values);
    expect(() => parse(ws)).toThrow("Duplicate FOC row");
    const incomplete = make();
    incomplete.spliceRows(row(incomplete, "FOC Received").number, 1);
    expect(() => parse(incomplete)).toThrow("needs paired Ordered, FOC and FOC Received rows");
    const bad = make();
    row(bad, "FOC Received").getCell(5).value = "maybe";
    expect(() => parse(bad)).toThrow("Received must be Yes or No");
  });
  it.each([-1, "abc", Infinity])("rejects invalid FOC quantity %s", quantity => {
    const ws = make();
    row(ws, "FOC").getCell(5).value = quantity;
    expect(() => parse(ws)).toThrow("Invalid quantity");
  });
  it("rejects received Yes without an entered quantity", () => {
    const ws = make();
    row(ws, "FOC Received", "New").getCell(5).value = "Yes";
    expect(() => parse(ws)).toThrow("Received FOC needs a quantity");
  });
  it("rejects unknown units", () => {
    const ws = make(); ws.getCell("D1").value = "Boxes";
    expect(() => parse(ws)).toThrow("Workbook unit must be MC, KG or Tons");
  });
});
