import ExcelJS from "exceljs";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Recommendation = {
  skuName: string;
  weight: string;
  category: string;
  packagingType?: string;
  recommendedMastercases: number;
  sharePercent: number;
  reasoning: string;
  trend: string;
  seasonalityNote: string;
  stockAlert?: string;
  confidenceScore?: number;
  primaryDriver?: string;
  marketIntelligenceNote?: string;
};

type ForecastSplitData = {
  totalTons: number;
  totalMastercases: number;
  mastercaseKg: number;
  targetMonth: number;
  targetYear: number;
  country: string;
  recommendations: Recommendation[];
  overallInsight: string;
  warnings: string[];
  marketSummary?: string;
  isRamadanMonth?: boolean;
  ramadanBoostPct?: number;
  marketSeasonalityIndex?: number;
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

export async function generateForecastSplitExcel(data: ForecastSplitData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();

  const monthLabel = MONTHS[data.targetMonth - 1] ?? `Month ${data.targetMonth}`;
  const periodLabel = `${monthLabel} ${data.targetYear}`;

  // ─── Summary Sheet ───
  const summaryWs = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF2563EB" } } });
  summaryWs.columns = [
    { width: 28 },
    { width: 50 },
  ];

  // Title
  const titleRow = summaryWs.addRow(["AI Forecast Split Recommendation"]);
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1E40AF" } };
  summaryWs.mergeCells("A1:B1");
  summaryWs.addRow([]);

  // Metadata
  const metaRows: [string, string | number][] = [
    ["Country", data.country],
    ["Target Period", periodLabel],
    ["Total Tons", data.totalTons],
    ["Total Master Cases", data.totalMastercases],
    ["Mastercase Weight (kg)", data.mastercaseKg],
    ["SKUs Covered", data.recommendations.length],
    ["SKUs with Allocation", data.recommendations.filter(r => r.recommendedMastercases > 0).length],
    ["Ramadan Month", data.isRamadanMonth ? `Yes (+${data.ramadanBoostPct}%)` : "No"],
    ["Seasonality Index", data.marketSeasonalityIndex?.toFixed(2) ?? "N/A"],
    ["Generated", new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })],
  ];

  for (const [label, value] of metaRows) {
    const row = summaryWs.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: "FF374151" } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    row.getCell(1).border = thinBorder;
    row.getCell(2).border = thinBorder;
  }

  summaryWs.addRow([]);

  // AI Insight
  if (data.overallInsight) {
    const insightHeader = summaryWs.addRow(["AI Analysis & Strategy"]);
    insightHeader.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1E40AF" } };
    const insightRow = summaryWs.addRow([data.overallInsight]);
    summaryWs.mergeCells(`A${insightRow.number}:B${insightRow.number}`);
    insightRow.getCell(1).alignment = { wrapText: true };
    insightRow.height = 60;
    summaryWs.addRow([]);
  }

  // Market Summary
  if (data.marketSummary) {
    const mktHeader = summaryWs.addRow(["Market Intelligence"]);
    mktHeader.getCell(1).font = { bold: true, size: 12, color: { argb: "FF4338CA" } };
    const mktRow = summaryWs.addRow([data.marketSummary]);
    summaryWs.mergeCells(`A${mktRow.number}:B${mktRow.number}`);
    mktRow.getCell(1).alignment = { wrapText: true };
    mktRow.height = 60;
    summaryWs.addRow([]);
  }

  // Warnings
  if (data.warnings.length > 0) {
    const warnHeader = summaryWs.addRow(["Warnings"]);
    warnHeader.getCell(1).font = { bold: true, size: 12, color: { argb: "FFD97706" } };
    for (const w of data.warnings) {
      const wRow = summaryWs.addRow([`• ${w}`]);
      summaryWs.mergeCells(`A${wRow.number}:B${wRow.number}`);
      wRow.getCell(1).font = { color: { argb: "FF92400E" } };
    }
  }

  // ─── SKU Split Sheet ───
  const skuWs = wb.addWorksheet("SKU Split", { properties: { tabColor: { argb: "FF059669" } } });

  const headers = [
    "SKU Name", "Weight", "Category", "Packaging", "Master Cases",
    "Share %", "Confidence %", "Trend", "Stock Alert", "Primary Driver",
    "Reasoning", "Seasonality Note", "Market Intelligence",
  ];

  skuWs.columns = [
    { width: 32 }, // SKU Name
    { width: 10 }, // Weight
    { width: 10 }, // Category
    { width: 12 }, // Packaging
    { width: 16 }, // Master Cases
    { width: 10 }, // Share %
    { width: 14 }, // Confidence
    { width: 12 }, // Trend
    { width: 14 }, // Stock Alert
    { width: 18 }, // Primary Driver
    { width: 40 }, // Reasoning
    { width: 35 }, // Seasonality
    { width: 35 }, // Market Intel
  ];

  // Title row
  const skuTitle = skuWs.addRow([`Forecast Split — ${data.country} — ${periodLabel}`]);
  skuTitle.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1E40AF" } };
  skuWs.mergeCells(`A1:M1`);

  // Subtitle row
  const subtitle = skuWs.addRow([
    `${data.totalMastercases.toLocaleString()} MC | ${data.totalTons} tons | ${data.mastercaseKg} kg/MC | ${data.recommendations.length} SKUs`,
  ]);
  subtitle.getCell(1).font = { size: 10, color: { argb: "FF6B7280" } };
  skuWs.mergeCells(`A2:M2`);

  skuWs.addRow([]); // blank row

  // Header row
  const headerRow = skuWs.addRow(headers);
  headerRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
    cell.border = thinBorder;
    cell.alignment = { vertical: "middle", horizontal: colNumber >= 5 && colNumber <= 7 ? "right" : "left" };
  });
  skuWs.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];

  // Sort: Core first, then by share descending
  const sorted = [...data.recommendations].sort((a, b) => {
    if (a.category === "Core" && b.category !== "Core") return -1;
    if (a.category !== "Core" && b.category === "Core") return 1;
    return b.sharePercent - a.sharePercent;
  });

  // Data rows
  let currentCategory = "";
  for (const rec of sorted) {
    // Category separator
    if (rec.category !== currentCategory) {
      currentCategory = rec.category;
      const catRow = skuWs.addRow([currentCategory === "Core" ? "CORE SKUs" : "NPI SKUs"]);
      catRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF374151" } };
      catRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      skuWs.mergeCells(`A${catRow.number}:M${catRow.number}`);
    }

    const driverLabels: Record<string, string> = {
      stock_critical: "Stock Critical",
      stock_overstock: "Overstock",
      ramadan_uplift: "Ramadan Uplift",
      summer_peak: "Summer Peak",
      winter_dip: "Winter Dip",
      trend_growth: "Trend Growth",
      trend_decline: "Trend Decline",
      historical_share: "Historical Share",
      market_intel: "Market Intel",
      low_data: "Low Data",
    };

    const row = skuWs.addRow([
      rec.skuName,
      rec.weight,
      rec.category,
      rec.packagingType ?? "New",
      rec.recommendedMastercases,
      rec.sharePercent,
      rec.confidenceScore ?? "",
      rec.trend.charAt(0).toUpperCase() + rec.trend.slice(1),
      rec.stockAlert ?? "unknown",
      driverLabels[rec.primaryDriver ?? ""] ?? (rec.primaryDriver ?? ""),
      rec.reasoning,
      rec.seasonalityNote || "",
      rec.marketIntelligenceNote || "",
    ]);

    // Style cells
    row.eachCell((cell, colNumber) => {
      cell.border = thinBorder;
      cell.alignment = { vertical: "top", wrapText: colNumber >= 11 };
      if (colNumber >= 5 && colNumber <= 7) cell.alignment = { ...cell.alignment, horizontal: "right" };
    });

    // Master Cases bold blue
    row.getCell(5).font = { bold: true, color: { argb: "FF1E40AF" } };
    row.getCell(5).numFmt = "#,##0";

    // Share %
    row.getCell(6).numFmt = "0.0";

    // Confidence color
    const conf = rec.confidenceScore;
    if (conf !== undefined) {
      if (conf >= 80) {
        row.getCell(7).font = { color: { argb: "FF059669" } };
      } else if (conf >= 55) {
        row.getCell(7).font = { color: { argb: "FF2563EB" } };
      } else {
        row.getCell(7).font = { color: { argb: "FFD97706" } };
      }
    }

    // Trend color
    const trendColors: Record<string, string> = {
      growing: "FF059669",
      declining: "FFDC2626",
      stable: "FF6B7280",
      new: "FF2563EB",
    };
    row.getCell(8).font = { color: { argb: trendColors[rec.trend] ?? "FF6B7280" } };

    // Stock alert color
    if (rec.stockAlert === "critical") {
      row.getCell(9).font = { bold: true, color: { argb: "FFDC2626" } };
      row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
    } else if (rec.stockAlert === "overstock") {
      row.getCell(9).font = { color: { argb: "FFD97706" } };
      row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
    } else if (rec.stockAlert === "healthy") {
      row.getCell(9).font = { color: { argb: "FF059669" } };
    }

    // Row height for reasoning columns
    if (rec.reasoning.length > 60 || (rec.seasonalityNote?.length ?? 0) > 60) {
      row.height = 45;
    }
  }

  // Totals row
  skuWs.addRow([]);
  const totalRow = skuWs.addRow([
    "TOTAL", "", "", "",
    data.recommendations.reduce((s, r) => s + r.recommendedMastercases, 0),
    data.recommendations.reduce((s, r) => s + r.sharePercent, 0),
  ]);
  totalRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF1E40AF" } };
  totalRow.getCell(5).font = { bold: true, size: 12, color: { argb: "FF1E40AF" } };
  totalRow.getCell(5).numFmt = "#,##0";
  totalRow.getCell(6).numFmt = "0.0";
  totalRow.getCell(6).font = { bold: true };
  for (let c = 1; c <= 13; c++) {
    totalRow.getCell(c).border = {
      top: { style: "medium", color: { argb: "FF1E40AF" } },
      bottom: { style: "medium", color: { argb: "FF1E40AF" } },
      left: thinBorder.left!,
      right: thinBorder.right!,
    };
    totalRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
  }

  // Unassigned row
  const unassigned = data.totalMastercases - data.recommendations.reduce((s, r) => s + r.recommendedMastercases, 0);
  if (unassigned > 0) {
    const unRow = skuWs.addRow(["Unassigned", "", "", "", unassigned]);
    unRow.getCell(1).font = { italic: true, color: { argb: "FFDC2626" } };
    unRow.getCell(5).font = { italic: true, color: { argb: "FFDC2626" } };
    unRow.getCell(5).numFmt = "#,##0";
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
