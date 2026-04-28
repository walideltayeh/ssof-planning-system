import { describe, it, expect } from "vitest";
import { generateForecastSplitExcel } from "./forecastSplitExcel";
import { loadXlsxBuffer } from "./excelLoad";

const sampleData = {
  totalTons: 180,
  totalMastercases: 30000,
  mastercaseKg: 6,
  targetMonth: 3,
  targetYear: 2026,
  country: "Syria",
  recommendations: [
    {
      skuName: "Al Fakher Double Apple",
      weight: "1kg",
      category: "Core",
      packagingType: "New",
      recommendedMastercases: 12000,
      sharePercent: 40.0,
      reasoning: "Highest historical share in Syria market",
      trend: "growing" as const,
      seasonalityNote: "March shows strong demand",
      stockAlert: "healthy",
      confidenceScore: 85,
      primaryDriver: "historical_share",
      marketIntelligenceNote: "Market leader in Syria",
    },
    {
      skuName: "Al Fakher Mint",
      weight: "250g",
      category: "Core",
      packagingType: "Old",
      recommendedMastercases: 8000,
      sharePercent: 26.7,
      reasoning: "Second highest demand SKU",
      trend: "stable" as const,
      seasonalityNote: "Consistent demand year-round",
      stockAlert: "critical",
      confidenceScore: 72,
      primaryDriver: "stock_critical",
    },
    {
      skuName: "Al Fakher Blueberry",
      weight: "50g",
      category: "NPI",
      recommendedMastercases: 2000,
      sharePercent: 6.7,
      reasoning: "New product introduction",
      trend: "new" as const,
      seasonalityNote: "",
      confidenceScore: 45,
      primaryDriver: "low_data",
    },
  ],
  overallInsight: "Syria market shows strong demand for traditional flavors",
  warnings: ["Low data for NPI SKUs"],
  marketSummary: "Syria market is recovering with increased demand",
  isRamadanMonth: true,
  ramadanBoostPct: 15,
  marketSeasonalityIndex: 1.15,
};

describe("generateForecastSplitExcel", () => {
  it("should generate a valid Excel buffer", async () => {
    const buffer = await generateForecastSplitExcel(sampleData);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should contain the XLSX magic bytes (PK zip header)", async () => {
    const buffer = await generateForecastSplitExcel(sampleData);
    // XLSX files are ZIP archives, starting with PK (0x50 0x4B)
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it("should parse back into a workbook with 2 sheets", async () => {
    const ExcelJS = await import("exceljs");
    const buffer = await generateForecastSplitExcel(sampleData);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    expect(wb.worksheets.length).toBe(2);
    expect(wb.worksheets[0].name).toBe("Summary");
    expect(wb.worksheets[1].name).toBe("SKU Split");
  });

  it("should include all SKU names in the SKU Split sheet", async () => {
    const ExcelJS = await import("exceljs");
    const buffer = await generateForecastSplitExcel(sampleData);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    const skuSheet = wb.getWorksheet("SKU Split")!;
    const cellValues: string[] = [];
    skuSheet.eachRow((row) => {
      const val = row.getCell(1).value;
      if (typeof val === "string") cellValues.push(val);
    });
    expect(cellValues).toContain("Al Fakher Double Apple");
    expect(cellValues).toContain("Al Fakher Mint");
    expect(cellValues).toContain("Al Fakher Blueberry");
  });

  it("should include Core and NPI category separators", async () => {
    const ExcelJS = await import("exceljs");
    const buffer = await generateForecastSplitExcel(sampleData);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    const skuSheet = wb.getWorksheet("SKU Split")!;
    const cellValues: string[] = [];
    skuSheet.eachRow((row) => {
      const val = row.getCell(1).value;
      if (typeof val === "string") cellValues.push(val);
    });
    expect(cellValues).toContain("CORE SKUs");
    expect(cellValues).toContain("NPI SKUs");
  });

  it("should include TOTAL row with correct mastercase sum", async () => {
    const ExcelJS = await import("exceljs");
    const buffer = await generateForecastSplitExcel(sampleData);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    const skuSheet = wb.getWorksheet("SKU Split")!;
    let totalMC = 0;
    skuSheet.eachRow((row) => {
      if (row.getCell(1).value === "TOTAL") {
        totalMC = row.getCell(5).value as number;
      }
    });
    expect(totalMC).toBe(22000); // 12000 + 8000 + 2000
  });

  it("should include country and period in Summary sheet", async () => {
    const ExcelJS = await import("exceljs");
    const buffer = await generateForecastSplitExcel(sampleData);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    const summarySheet = wb.getWorksheet("Summary")!;
    const values: (string | number | null)[] = [];
    summarySheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value) values.push(String(cell.value));
      });
    });
    const joined = values.join(" ");
    expect(joined).toContain("Syria");
    expect(joined).toContain("March 2026");
  });

  it("should include Ramadan info in Summary when isRamadanMonth is true", async () => {
    const ExcelJS = await import("exceljs");
    const buffer = await generateForecastSplitExcel(sampleData);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    const summarySheet = wb.getWorksheet("Summary")!;
    const values: string[] = [];
    summarySheet.eachRow((row) => {
      row.eachCell((cell) => {
        if (cell.value) values.push(String(cell.value));
      });
    });
    const joined = values.join(" ");
    expect(joined).toContain("Yes (+15%)");
  });

  it("should handle empty recommendations gracefully", async () => {
    const emptyData = {
      ...sampleData,
      recommendations: [],
      warnings: [],
    };
    const buffer = await generateForecastSplitExcel(emptyData);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it("should include unassigned row when total exceeds assigned", async () => {
    const ExcelJS = await import("exceljs");
    const buffer = await generateForecastSplitExcel(sampleData);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    const skuSheet = wb.getWorksheet("SKU Split")!;
    let hasUnassigned = false;
    skuSheet.eachRow((row) => {
      if (row.getCell(1).value === "Unassigned") {
        hasUnassigned = true;
        // 30000 - 22000 = 8000 unassigned
        expect(row.getCell(5).value).toBe(8000);
      }
    });
    expect(hasUnassigned).toBe(true);
  });

  it("should NOT include unassigned row when fully allocated", async () => {
    const ExcelJS = await import("exceljs");
    const fullyAllocated = {
      ...sampleData,
      totalMastercases: 22000, // exactly matches sum
    };
    const buffer = await generateForecastSplitExcel(fullyAllocated);
    const wb = new ExcelJS.Workbook();
    await loadXlsxBuffer(wb, buffer);
    const skuSheet = wb.getWorksheet("SKU Split")!;
    let hasUnassigned = false;
    skuSheet.eachRow((row) => {
      if (row.getCell(1).value === "Unassigned") hasUnassigned = true;
    });
    expect(hasUnassigned).toBe(false);
  });
});
