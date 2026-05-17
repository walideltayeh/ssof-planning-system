import ExcelJS from "exceljs";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

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

type MonthResult = {
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

type MultiMonthData = {
  duration: number;
  startMonth: number;
  startYear: number;
  totalTons: number;
  mastercaseKg: number;
  country: string;
  monthResults: MonthResult[];
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFD0D0D0" } },
  left: { style: "thin", color: { argb: "FFD0D0D0" } },
  bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
  right: { style: "thin", color: { argb: "FFD0D0D0" } },
};

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

const trendColors: Record<string, string> = {
  growing: "FF059669",
  declining: "FFDC2626",
  stable: "FF6B7280",
  new: "FF2563EB",
};

export async function generateMultiMonthForecastSplitExcel(data: MultiMonthData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();

  const startLabel = `${SHORT_MONTHS[data.startMonth - 1]} ${data.startYear}`;
  const lastMonth = data.monthResults[data.monthResults.length - 1];
  const endLabel = lastMonth ? `${SHORT_MONTHS[lastMonth.targetMonth - 1]} ${lastMonth.targetYear}` : startLabel;

  // ─── Overview Sheet ───
  const overviewWs = wb.addWorksheet("Overview", { properties: { tabColor: { argb: "FF2563EB" } } });
  overviewWs.columns = [{ width: 30 }, { width: 55 }];

  const titleRow = overviewWs.addRow([`Multi-Month Forecast Split — ${data.country}`]);
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: "FF1E40AF" } };
  overviewWs.mergeCells("A1:B1");
  overviewWs.addRow([]);

  const metaRows: [string, string | number][] = [
    ["Country", data.country],
    ["Duration", `${data.duration} months`],
    ["Period", `${startLabel} → ${endLabel}`],
    ["Tons per Month", data.totalTons],
    ["Master Cases per Month", data.monthResults[0]?.totalMastercases ?? 0],
    ["Mastercase Weight (kg)", data.mastercaseKg],
    ["Total Volume", `${(data.totalTons * data.duration).toFixed(1)} tons / ${(data.monthResults.reduce((s, r) => s + r.totalMastercases, 0)).toLocaleString()} MC`],
    ["Months Generated", data.monthResults.length],
    ["Generated", new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })],
  ];

  for (const [label, value] of metaRows) {
    const row = overviewWs.addRow([label, value]);
    row.getCell(1).font = { bold: true, color: { argb: "FF374151" } };
    row.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    row.getCell(1).border = thinBorder;
    row.getCell(2).border = thinBorder;
  }

  overviewWs.addRow([]);

  // Per-month summary table
  const monthSummaryHeader = overviewWs.addRow(["Month-by-Month Summary"]);
  monthSummaryHeader.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1E40AF" } };
  overviewWs.addRow([]);

  // Create a wider table for the month summary
  const msHeaders = ["Month", "Year", "Total MC", "Tons", "SKUs", "Ramadan", "Seasonality Index"];
  const msHeaderRow = overviewWs.addRow(msHeaders);
  msHeaderRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
    cell.border = thinBorder;
  });

  for (const mr of data.monthResults) {
    const row = overviewWs.addRow([
      MONTHS[mr.targetMonth - 1],
      mr.targetYear,
      mr.totalMastercases,
      mr.totalTons,
      mr.recommendations.length,
      mr.isRamadanMonth ? `Yes (+${mr.ramadanBoostPct}%)` : "No",
      mr.marketSeasonalityIndex?.toFixed(2) ?? "N/A",
    ]);
    row.eachCell((cell) => { cell.border = thinBorder; });
    row.getCell(3).numFmt = "#,##0";
    if (mr.isRamadanMonth) {
      row.getCell(6).font = { bold: true, color: { argb: "FF7C3AED" } };
    }
  }

  overviewWs.addRow([]);

  // AI insights per month
  const insightsHeader = overviewWs.addRow(["AI Insights by Month"]);
  insightsHeader.getCell(1).font = { bold: true, size: 12, color: { argb: "FF1E40AF" } };
  overviewWs.addRow([]);

  for (const mr of data.monthResults) {
    const monthLabel = `${MONTHS[mr.targetMonth - 1]} ${mr.targetYear}`;
    const mhRow = overviewWs.addRow([monthLabel]);
    mhRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF374151" } };
    mhRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
    overviewWs.mergeCells(`A${mhRow.number}:B${mhRow.number}`);
    
    if (mr.overallInsight) {
      const insightRow = overviewWs.addRow([mr.overallInsight]);
      overviewWs.mergeCells(`A${insightRow.number}:B${insightRow.number}`);
      insightRow.getCell(1).alignment = { wrapText: true };
      insightRow.height = 50;
    }
    if (mr.warnings.length > 0) {
      for (const w of mr.warnings) {
        const wRow = overviewWs.addRow([`⚠ ${w}`]);
        overviewWs.mergeCells(`A${wRow.number}:B${wRow.number}`);
        wRow.getCell(1).font = { color: { argb: "FF92400E" } };
      }
    }
    overviewWs.addRow([]);
  }

  // ─── Cross-Month Comparison Sheet ───
  const compWs = wb.addWorksheet("SKU Comparison", { properties: { tabColor: { argb: "FF059669" } } });
  
  // Build comparison: SKU × Month mastercases
  const allSkuNames = new Set<string>();
  for (const mr of data.monthResults) {
    for (const rec of mr.recommendations) {
      allSkuNames.add(`${rec.skuName}|${rec.weight}|${rec.category}|${rec.packagingType ?? 'New'}`);
    }
  }
  const skuList = Array.from(allSkuNames).sort((a, b) => {
    const [, , catA] = a.split('|');
    const [, , catB] = b.split('|');
    if (catA === 'Core' && catB !== 'Core') return -1;
    if (catA !== 'Core' && catB === 'Core') return 1;
    return a.localeCompare(b);
  });

  // Title
  const compTitle = compWs.addRow([`SKU × Month Comparison — ${data.country} — ${startLabel} to ${endLabel}`]);
  compTitle.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1E40AF" } };
  compWs.addRow([]);

  // Headers: SKU, Weight, Category, Pkg, Month1, Month2, ..., Total
  const monthHeaders = data.monthResults.map(mr => `${SHORT_MONTHS[mr.targetMonth - 1]} ${mr.targetYear}`);
  const compHeaders = ["SKU Name", "Weight", "Category", "Packaging", ...monthHeaders, "Total MC", "Avg MC"];
  const compHeaderRow = compWs.addRow(compHeaders);
  compHeaderRow.eachCell((cell, colNumber) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
    cell.border = thinBorder;
    if (colNumber >= 5) cell.alignment = { horizontal: "right" };
  });

  // Set column widths
  compWs.columns = [
    { width: 30 }, // SKU
    { width: 10 }, // Weight
    { width: 10 }, // Category
    { width: 10 }, // Pkg
    ...monthHeaders.map(() => ({ width: 14 })),
    { width: 14 }, // Total
    { width: 14 }, // Avg
  ];

  compWs.views = [{ state: "frozen", ySplit: 3, xSplit: 4 }];

  // Data rows
  let currentCat = "";
  for (const skuKey of skuList) {
    const [skuName, weight, category, pkg] = skuKey.split('|');
    
    // Category separator
    if (category !== currentCat) {
      currentCat = category;
      const catRow = compWs.addRow([category === "Core" ? "CORE SKUs" : "NPI SKUs"]);
      catRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF374151" } };
      catRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
      const lastCol = 4 + data.monthResults.length + 2;
      compWs.mergeCells(`A${catRow.number}:${String.fromCharCode(64 + Math.min(lastCol, 26))}${catRow.number}`);
    }

    // Match on ALL FOUR identity fields so two SKUs that share name+weight
    // but differ in category or packaging (e.g. "Double Apple 50g New" vs
    // "Double Apple 50g Old") don't collide and pull the wrong row's MC,
    // which previously caused the SKU Comparison tab totals to disagree
    // with the per-month tabs.
    const monthValues = data.monthResults.map(mr => {
      const rec = mr.recommendations.find(r =>
        r.skuName === skuName &&
        r.weight === weight &&
        r.category === category &&
        (r.packagingType ?? 'New') === pkg
      );
      return Math.round(rec?.recommendedMastercases ?? 0);
    });
    const total = monthValues.reduce((s, v) => s + v, 0);
    const avg = monthValues.length > 0 ? Math.round(total / monthValues.length) : 0;

    const row = compWs.addRow([skuName, weight, category, pkg, ...monthValues, total, avg]);
    row.eachCell((cell, colNumber) => {
      cell.border = thinBorder;
      if (colNumber >= 5) {
        cell.numFmt = "#,##0";
        cell.alignment = { horizontal: "right" };
      }
    });
    // Bold totals
    row.getCell(compHeaders.length - 1).font = { bold: true, color: { argb: "FF1E40AF" } };
    row.getCell(compHeaders.length).font = { bold: true, color: { argb: "FF6B7280" } };
  }

  // Totals row — sum rounded per-row values so =SUM(...) in Excel matches.
  compWs.addRow([]);
  const totalValues = data.monthResults.map(mr =>
    mr.recommendations.reduce((s, r) => s + Math.round(r.recommendedMastercases), 0)
  );
  const grandTotal = totalValues.reduce((s, v) => s + v, 0);
  const grandAvg = totalValues.length > 0 ? Math.round(grandTotal / totalValues.length) : 0;
  const totalRow = compWs.addRow(["TOTAL", "", "", "", ...totalValues, grandTotal, grandAvg]);
  totalRow.eachCell((cell, colNumber) => {
    cell.border = {
      top: { style: "medium", color: { argb: "FF1E40AF" } },
      bottom: { style: "medium", color: { argb: "FF1E40AF" } },
      left: thinBorder.left!,
      right: thinBorder.right!,
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
    if (colNumber >= 5) {
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right" };
    }
  });
  totalRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF1E40AF" } };

  // ─── Per-Month Detail Sheets ───
  for (const mr of data.monthResults) {
    const monthLabel = `${SHORT_MONTHS[mr.targetMonth - 1]} ${mr.targetYear}`;
    const ws = wb.addWorksheet(monthLabel, {
      properties: { tabColor: { argb: mr.isRamadanMonth ? "FF7C3AED" : "FF059669" } },
    });

    const headers = [
      "SKU Name", "Weight", "Category", "Packaging", "Master Cases",
      "Share %", "Confidence %", "Trend", "Stock Alert", "Primary Driver",
      "Reasoning", "Seasonality Note", "Market Intelligence",
    ];

    ws.columns = [
      { width: 32 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 16 },
      { width: 10 }, { width: 14 }, { width: 12 }, { width: 14 }, { width: 18 },
      { width: 40 }, { width: 35 }, { width: 35 },
    ];

    // Title
    const skuTitle = ws.addRow([`Forecast Split — ${mr.country} — ${MONTHS[mr.targetMonth - 1]} ${mr.targetYear}`]);
    skuTitle.getCell(1).font = { bold: true, size: 14, color: { argb: "FF1E40AF" } };
    ws.mergeCells(`A1:M1`);

    const subtitle = ws.addRow([
      `${mr.totalMastercases.toLocaleString()} MC | ${mr.totalTons} tons | ${mr.mastercaseKg} kg/MC | ${mr.recommendations.length} SKUs${mr.isRamadanMonth ? ` | RAMADAN +${mr.ramadanBoostPct}%` : ''}`,
    ]);
    subtitle.getCell(1).font = { size: 10, color: { argb: mr.isRamadanMonth ? "FF7C3AED" : "FF6B7280" } };
    ws.mergeCells(`A2:M2`);

    ws.addRow([]);

    const headerRow = ws.addRow(headers);
    headerRow.eachCell((cell, colNumber) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } };
      cell.border = thinBorder;
      cell.alignment = { vertical: "middle", horizontal: colNumber >= 5 && colNumber <= 7 ? "right" : "left" };
    });
    ws.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];

    const sorted = [...mr.recommendations].sort((a, b) => {
      if (a.category === "Core" && b.category !== "Core") return -1;
      if (a.category !== "Core" && b.category === "Core") return 1;
      return b.sharePercent - a.sharePercent;
    });

    let currentCategory = "";
    for (const rec of sorted) {
      if (rec.category !== currentCategory) {
        currentCategory = rec.category;
        const catRow = ws.addRow([currentCategory === "Core" ? "CORE SKUs" : "NPI SKUs"]);
        catRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF374151" } };
        catRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        ws.mergeCells(`A${catRow.number}:M${catRow.number}`);
      }

      const row = ws.addRow([
        rec.skuName, rec.weight, rec.category, rec.packagingType ?? "New",
        Math.round(rec.recommendedMastercases), Math.round(rec.sharePercent * 10) / 10, rec.confidenceScore ?? "",
        rec.trend.charAt(0).toUpperCase() + rec.trend.slice(1),
        rec.stockAlert ?? "unknown",
        driverLabels[rec.primaryDriver ?? ""] ?? (rec.primaryDriver ?? ""),
        rec.reasoning, rec.seasonalityNote || "", rec.marketIntelligenceNote || "",
      ]);

      row.eachCell((cell, colNumber) => {
        cell.border = thinBorder;
        cell.alignment = { vertical: "top", wrapText: colNumber >= 11 };
        if (colNumber >= 5 && colNumber <= 7) cell.alignment = { ...cell.alignment, horizontal: "right" };
      });

      row.getCell(5).font = { bold: true, color: { argb: "FF1E40AF" } };
      row.getCell(5).numFmt = "#,##0";
      row.getCell(6).numFmt = "0.0";

      const conf = rec.confidenceScore;
      if (conf !== undefined) {
        if (conf >= 80) row.getCell(7).font = { color: { argb: "FF059669" } };
        else if (conf >= 55) row.getCell(7).font = { color: { argb: "FF2563EB" } };
        else row.getCell(7).font = { color: { argb: "FFD97706" } };
      }

      row.getCell(8).font = { color: { argb: trendColors[rec.trend] ?? "FF6B7280" } };

      if (rec.stockAlert === "critical") {
        row.getCell(9).font = { bold: true, color: { argb: "FFDC2626" } };
        row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
      } else if (rec.stockAlert === "overstock") {
        row.getCell(9).font = { color: { argb: "FFD97706" } };
        row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFBEB" } };
      } else if (rec.stockAlert === "healthy") {
        row.getCell(9).font = { color: { argb: "FF059669" } };
      }

      if (rec.reasoning.length > 60 || (rec.seasonalityNote?.length ?? 0) > 60) {
        row.height = 45;
      }
    }

    // Totals — sum rounded per-row values so =SUM(...) in Excel matches.
    ws.addRow([]);
    const mTotalMc = mr.recommendations.reduce((s, r) => s + Math.round(r.recommendedMastercases), 0);
    const mTotalShare = mr.recommendations.reduce((s, r) => s + Math.round(r.sharePercent * 10) / 10, 0);
    const mTotalRow = ws.addRow([
      "TOTAL", "", "", "",
      mTotalMc,
      Math.round(mTotalShare * 10) / 10,
    ]);
    mTotalRow.getCell(1).font = { bold: true, size: 11, color: { argb: "FF1E40AF" } };
    mTotalRow.getCell(5).font = { bold: true, size: 12, color: { argb: "FF1E40AF" } };
    mTotalRow.getCell(5).numFmt = "#,##0";
    mTotalRow.getCell(6).numFmt = "0.0";
    mTotalRow.getCell(6).font = { bold: true };
    for (let c = 1; c <= 13; c++) {
      mTotalRow.getCell(c).border = {
        top: { style: "medium", color: { argb: "FF1E40AF" } },
        bottom: { style: "medium", color: { argb: "FF1E40AF" } },
        left: thinBorder.left!,
        right: thinBorder.right!,
      };
      mTotalRow.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
