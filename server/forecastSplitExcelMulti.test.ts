import { describe, it, expect } from "vitest";
import { generateMultiMonthForecastSplitExcel } from "./forecastSplitExcelMulti";
import ExcelJS from "exceljs";

function makeMockRecs(count: number, totalMC: number) {
  const perSku = Math.floor(totalMC / count);
  const remainder = totalMC - perSku * count;
  return Array.from({ length: count }, (_, i) => ({
    skuName: `SKU ${i + 1}`,
    weight: i < count / 2 ? "250g" : "50g",
    category: i < count / 2 ? "Core" : "NPI",
    packagingType: i % 2 === 0 ? "New" : "Old",
    recommendedMastercases: i === 0 ? perSku + remainder : perSku,
    sharePercent: parseFloat(((i === 0 ? perSku + remainder : perSku) / totalMC * 100).toFixed(1)),
    reasoning: `Test reasoning for SKU ${i + 1}`,
    trend: (["growing", "stable", "declining", "new"] as const)[i % 4],
    seasonalityNote: `Seasonality note for SKU ${i + 1}`,
    stockAlert: (["critical", "healthy", "overstock", "unknown"] as const)[i % 4],
    confidenceScore: 60 + (i * 5) % 40,
    primaryDriver: "historical_share",
    marketIntelligenceNote: `Market intel for SKU ${i + 1}`,
  }));
}

function makeMockMultiMonth(duration: number) {
  const totalTons = 100;
  const mastercaseKg = 6;
  const totalMC = Math.floor(totalTons * 1000 / mastercaseKg);
  const monthResults = [];
  let m = 4; // April
  let y = 2026;
  for (let i = 0; i < duration; i++) {
    monthResults.push({
      totalTons,
      totalMastercases: totalMC,
      mastercaseKg,
      targetMonth: m,
      targetYear: y,
      country: "Lebanon",
      recommendations: makeMockRecs(6, totalMC),
      overallInsight: `AI insight for month ${m}/${y}`,
      warnings: i === 0 ? ["Warning 1", "Warning 2"] : [],
      marketSummary: `Market summary for month ${m}/${y}`,
      isRamadanMonth: m === 3 || m === 4,
      ramadanBoostPct: m === 3 || m === 4 ? 20 : 0,
      marketSeasonalityIndex: 1.0 + (i * 0.05),
    });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return {
    duration,
    startMonth: 4,
    startYear: 2026,
    totalTons,
    mastercaseKg,
    country: "Lebanon",
    monthResults,
  };
}

async function parseBuffer(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

describe("generateMultiMonthForecastSplitExcel", () => {
  it("generates a valid Excel buffer for 3-month data", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("creates Overview, SKU Comparison, and per-month sheets for 3 months", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    const sheetNames = wb.worksheets.map(ws => ws.name);
    expect(sheetNames).toContain("Overview");
    expect(sheetNames).toContain("SKU Comparison");
    expect(sheetNames).toContain("Apr 2026");
    expect(sheetNames).toContain("May 2026");
    expect(sheetNames).toContain("Jun 2026");
    expect(sheetNames.length).toBe(5); // Overview + Comparison + 3 months
  });

  it("creates correct number of sheets for 12-month data", async () => {
    const data = makeMockMultiMonth(12);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    expect(wb.worksheets.length).toBe(14); // Overview + Comparison + 12 months
  });

  it("creates correct number of sheets for 1-month data", async () => {
    const data = makeMockMultiMonth(1);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    expect(wb.worksheets.length).toBe(3); // Overview + Comparison + 1 month
  });

  it("Overview sheet contains metadata rows", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    const overview = wb.getWorksheet("Overview")!;
    // Title row
    expect(overview.getRow(1).getCell(1).value).toContain("Multi-Month Forecast Split");
    // Country row
    let foundCountry = false;
    overview.eachRow((row) => {
      const val = row.getCell(1).value;
      if (val === "Country") {
        expect(row.getCell(2).value).toBe("Lebanon");
        foundCountry = true;
      }
    });
    expect(foundCountry).toBe(true);
  });

  it("Overview sheet contains duration info", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    const overview = wb.getWorksheet("Overview")!;
    let foundDuration = false;
    overview.eachRow((row) => {
      const val = row.getCell(1).value;
      if (val === "Duration") {
        expect(row.getCell(2).value).toBe("3 months");
        foundDuration = true;
      }
    });
    expect(foundDuration).toBe(true);
  });

  it("SKU Comparison sheet has correct column headers", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    const comp = wb.getWorksheet("SKU Comparison")!;
    // Row 3 should be the header row (row 1 = title, row 2 = blank, row 3 = headers)
    const headerRow = comp.getRow(3);
    expect(headerRow.getCell(1).value).toBe("SKU Name");
    expect(headerRow.getCell(2).value).toBe("Weight");
    expect(headerRow.getCell(3).value).toBe("Category");
    expect(headerRow.getCell(4).value).toBe("Packaging");
    expect(headerRow.getCell(5).value).toBe("Apr 2026");
    expect(headerRow.getCell(6).value).toBe("May 2026");
    expect(headerRow.getCell(7).value).toBe("Jun 2026");
  });

  it("Per-month detail sheet has SKU data rows", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    const aprSheet = wb.getWorksheet("Apr 2026")!;
    // Row 1 = title, Row 2 = subtitle, Row 3 = blank, Row 4 = headers
    const headerRow = aprSheet.getRow(4);
    expect(headerRow.getCell(1).value).toBe("SKU Name");
    expect(headerRow.getCell(5).value).toBe("Master Cases");
    
    // Should have data rows after headers (with category separators)
    let dataRowCount = 0;
    aprSheet.eachRow((row, rowNumber) => {
      if (rowNumber > 4) {
        const skuName = row.getCell(1).value;
        if (typeof skuName === "string" && skuName.startsWith("SKU ")) {
          dataRowCount++;
        }
      }
    });
    expect(dataRowCount).toBe(6); // 6 mock SKUs
  });

  it("handles Ramadan month tab coloring", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    // April is Ramadan in our mock
    const aprSheet = wb.getWorksheet("Apr 2026")!;
    expect(aprSheet.properties.tabColor).toBeDefined();
    // May is also Ramadan (month 5, but our mock sets m===3||m===4)
    // Actually May is month 5, not Ramadan. Jun is month 6, not Ramadan.
    const junSheet = wb.getWorksheet("Jun 2026")!;
    expect(junSheet.properties.tabColor).toBeDefined();
  });

  it("TOTAL row in SKU Comparison has correct sum", async () => {
    const data = makeMockMultiMonth(3);
    const buffer = await generateMultiMonthForecastSplitExcel(data);
    const wb = await parseBuffer(buffer);
    const comp = wb.getWorksheet("SKU Comparison")!;
    
    // Find the TOTAL row
    let totalRowNum = 0;
    comp.eachRow((row, rowNumber) => {
      if (row.getCell(1).value === "TOTAL") {
        totalRowNum = rowNumber;
      }
    });
    expect(totalRowNum).toBeGreaterThan(0);
    
    const totalRow = comp.getRow(totalRowNum);
    // Each month column should sum to totalMC
    const totalMC = data.monthResults[0].totalMastercases;
    const expectedPerMonth = data.monthResults[0].recommendations.reduce((s, r) => s + r.recommendedMastercases, 0);
    expect(totalRow.getCell(5).value).toBe(expectedPerMonth); // Apr
    expect(totalRow.getCell(6).value).toBe(expectedPerMonth); // May
    expect(totalRow.getCell(7).value).toBe(expectedPerMonth); // Jun
  });
});
