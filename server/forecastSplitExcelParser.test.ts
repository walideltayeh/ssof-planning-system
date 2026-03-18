/**
 * Tests for forecastSplitExcelParser.ts
 * Verifies that uploaded (possibly modified) Excel workbooks are correctly parsed.
 */
import { describe, it, expect, beforeAll } from "vitest";
import ExcelJS from "exceljs";
import { parseForecastSplitExcel } from "./forecastSplitExcelParser";

/** Build a minimal single-month "SKU Split" workbook in memory */
async function buildSingleMonthWorkbook(opts: {
  country: string;
  month: string; // e.g. "April 2026"
  rows: Array<{ skuName: string; weight: string; category: string; mc: number }>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("SKU Split");

  // Row 1: title
  ws.addRow([`Forecast Split — ${opts.country} — ${opts.month}`]);
  // Row 2: subtitle
  ws.addRow(["100 MC | 10 tons | 6 kg/MC | 3 SKUs"]);
  // Row 3: blank
  ws.addRow([]);
  // Row 4: header
  ws.addRow(["SKU Name", "Weight", "Category", "Packaging", "Master Cases", "Share %", "Confidence", "Trend", "Stock Alert", "Driver", "Reasoning", "Seasonality", "Market Intel"]);

  let currentCategory = "";
  for (const r of opts.rows) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      ws.addRow([currentCategory === "Core" ? "CORE SKUs" : "NPI SKUs"]);
    }
    ws.addRow([r.skuName, r.weight, r.category, "New", r.mc, 33.3, 85, "growing", "ok", "historical_share", "Test reasoning", "", ""]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/** Build a minimal multi-month workbook with Overview + per-month sheets */
async function buildMultiMonthWorkbook(opts: {
  months: Array<{
    label: string; // e.g. "Apr 2026"
    country: string;
    rows: Array<{ skuName: string; weight: string; category: string; mc: number }>;
  }>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // Overview sheet
  const overviewWs = wb.addWorksheet("Overview");
  overviewWs.addRow(["Multi-Month Forecast Overview"]);

  // Per-month sheets
  for (const m of opts.months) {
    const ws = wb.addWorksheet(m.label);
    ws.addRow([`Forecast Split — ${m.country} — ${m.label}`]);
    ws.addRow(["100 MC | 10 tons | 6 kg/MC"]);
    ws.addRow([]);
    ws.addRow(["SKU Name", "Weight", "Category", "Packaging", "Master Cases", "Share %", "Confidence", "Trend", "Stock Alert", "Driver", "Reasoning", "Seasonality", "Market Intel"]);
    let currentCategory = "";
    for (const r of m.rows) {
      if (r.category !== currentCategory) {
        currentCategory = r.category;
        ws.addRow([currentCategory === "Core" ? "CORE SKUs" : "NPI SKUs"]);
      }
      ws.addRow([r.skuName, r.weight, r.category, "New", r.mc, 50, 80, "stable", "ok", "historical_share", "Reasoning", "", ""]);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

describe("parseForecastSplitExcel — single-month", () => {
  let buf: Buffer;

  beforeAll(async () => {
    buf = await buildSingleMonthWorkbook({
      country: "Lebanon",
      month: "April 2026",
      rows: [
        { skuName: "Al Fakher Apple 250g", weight: "250g", category: "Core", mc: 500 },
        { skuName: "Al Fakher Grape 250g", weight: "250g", category: "Core", mc: 300 },
        { skuName: "Al Fakher Mint 50g", weight: "50g", category: "NPI", mc: 200 },
      ],
    });
  });

  it("returns type=single", async () => {
    const result = await parseForecastSplitExcel(buf);
    expect(result.type).toBe("single");
  });

  it("extracts correct month and year", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "single") throw new Error("Expected single");
    expect(result.month.targetMonth).toBe(4);
    expect(result.month.targetYear).toBe(2026);
  });

  it("extracts correct country", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "single") throw new Error("Expected single");
    expect(result.month.country).toBe("Lebanon");
  });

  it("parses all 3 SKU rows", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "single") throw new Error("Expected single");
    expect(result.month.rows).toHaveLength(3);
  });

  it("correctly reads mastercase values", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "single") throw new Error("Expected single");
    const apple = result.month.rows.find(r => r.skuName === "Al Fakher Apple 250g");
    expect(apple?.recommendedMastercases).toBe(500);
    const mint = result.month.rows.find(r => r.skuName === "Al Fakher Mint 50g");
    expect(mint?.recommendedMastercases).toBe(200);
  });

  it("computes correct totalMastercases", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "single") throw new Error("Expected single");
    expect(result.month.totalMastercases).toBe(1000);
  });
});

describe("parseForecastSplitExcel — multi-month", () => {
  let buf: Buffer;

  beforeAll(async () => {
    buf = await buildMultiMonthWorkbook({
      months: [
        {
          label: "Apr 2026",
          country: "Lebanon",
          rows: [
            { skuName: "SKU A", weight: "250g", category: "Core", mc: 400 },
            { skuName: "SKU B", weight: "50g", category: "NPI", mc: 100 },
          ],
        },
        {
          label: "May 2026",
          country: "Lebanon",
          rows: [
            { skuName: "SKU A", weight: "250g", category: "Core", mc: 350 },
            { skuName: "SKU B", weight: "50g", category: "NPI", mc: 150 },
          ],
        },
        {
          label: "Jun 2026",
          country: "Lebanon",
          rows: [
            { skuName: "SKU A", weight: "250g", category: "Core", mc: 420 },
            { skuName: "SKU B", weight: "50g", category: "NPI", mc: 80 },
          ],
        },
      ],
    });
  });

  it("returns type=multi", async () => {
    const result = await parseForecastSplitExcel(buf);
    expect(result.type).toBe("multi");
  });

  it("parses 3 months", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "multi") throw new Error("Expected multi");
    expect(result.months).toHaveLength(3);
  });

  it("months are sorted chronologically", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "multi") throw new Error("Expected multi");
    expect(result.months[0].targetMonth).toBe(4);
    expect(result.months[1].targetMonth).toBe(5);
    expect(result.months[2].targetMonth).toBe(6);
  });

  it("parses correct MC values per month", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "multi") throw new Error("Expected multi");
    expect(result.months[0].totalMastercases).toBe(500);
    expect(result.months[1].totalMastercases).toBe(500);
    expect(result.months[2].totalMastercases).toBe(500);
  });

  it("each month has 2 SKU rows", async () => {
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "multi") throw new Error("Expected multi");
    for (const m of result.months) {
      expect(m.rows).toHaveLength(2);
    }
  });
});

describe("parseForecastSplitExcel — error cases", () => {
  it("throws on missing SKU Split sheet in single-month format", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Wrong Sheet");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseForecastSplitExcel(buf)).rejects.toThrow("SKU Split");
  });

  it("handles modified MC values (user edited cells)", async () => {
    const buf = await buildSingleMonthWorkbook({
      country: "Syria",
      month: "June 2026",
      rows: [
        { skuName: "SKU X", weight: "250g", category: "Core", mc: 999 },
      ],
    });
    const result = await parseForecastSplitExcel(buf);
    if (result.type !== "single") throw new Error("Expected single");
    expect(result.month.rows[0].recommendedMastercases).toBe(999);
  });
});
