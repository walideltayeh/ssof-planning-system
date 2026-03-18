/**
 * forecastSplitExcelParser.ts
 *
 * Parses an uploaded (possibly modified) AI Forecast Split Excel file and
 * extracts the SKU rows with their (potentially edited) Master Case values.
 *
 * Supports both single-month ("SKU Split" sheet) and multi-month
 * ("Overview", "SKU Comparison", per-month sheets) workbook formats.
 */
import ExcelJS from "exceljs";

export type ParsedSkuRow = {
  skuName: string;
  weight: string;
  category: string;
  recommendedMastercases: number;
};

export type ParsedForecastMonth = {
  /** 1-based month number */
  targetMonth: number;
  targetYear: number;
  country: string;
  totalMastercases: number;
  rows: ParsedSkuRow[];
};

export type ParsedUploadResult =
  | { type: "single"; month: ParsedForecastMonth }
  | { type: "multi"; months: ParsedForecastMonth[] };

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Parse a month label like "April 2026" or "Apr 2026" → { month: 4, year: 2026 } */
function parsePeriodLabel(label: string): { month: number; year: number } | null {
  for (let i = 0; i < 12; i++) {
    const longName = MONTHS_EN[i];
    const shortName = SHORT_MONTHS[i];
    const yearMatch = label.match(/\b(20\d{2})\b/);
    if (!yearMatch) continue;
    const year = parseInt(yearMatch[1]);
    if (label.includes(longName) || label.includes(shortName)) {
      return { month: i + 1, year };
    }
  }
  return null;
}

/** Extract country from a title string like "Forecast Split — Lebanon — April 2026" */
function extractCountry(title: string): string {
  const parts = title.split("—").map(s => s.trim());
  if (parts.length >= 2) return parts[1];
  return "Unknown";
}

/**
 * Parse the "SKU Split" sheet (single-month format).
 * Header row is row 4 (1-indexed). Data rows follow.
 * Columns: A=SKU Name, B=Weight, C=Category, D=Packaging, E=Master Cases, ...
 * Category separator rows (merged, text = "CORE SKUs" or "NPI SKUs") are skipped.
 */
function parseSkuSplitSheet(ws: ExcelJS.Worksheet): { rows: ParsedSkuRow[]; country: string; period: string } {
  const rows: ParsedSkuRow[] = [];
  let country = "Unknown";
  let period = "";
  let currentCategory = "Core";

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      // Title: "Forecast Split — Lebanon — April 2026"
      const cellVal = String(row.getCell(1).value ?? "");
      country = extractCountry(cellVal);
      const periodMatch = cellVal.match(/((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+20\d{2})/i);
      if (periodMatch) period = periodMatch[1];
      return;
    }
    if (rowNumber <= 3) return; // subtitle + blank + (will be header at row 4)
    if (rowNumber === 4) return; // header row

    const cellA = String(row.getCell(1).value ?? "").trim();
    const cellB = String(row.getCell(2).value ?? "").trim();
    const cellC = String(row.getCell(3).value ?? "").trim();
    const cellE = row.getCell(5).value;

    // Category separator rows
    if (cellA === "CORE SKUs" || cellA === "CORE") { currentCategory = "Core"; return; }
    if (cellA === "NPI SKUs" || cellA === "NPI") { currentCategory = "NPI"; return; }

    // Skip empty rows
    if (!cellA || cellA === "") return;

    // Parse master cases — allow user to have edited this cell
    let mc = 0;
    if (typeof cellE === "number") {
      mc = Math.round(cellE);
    } else if (cellE !== null && cellE !== undefined) {
      const parsed = parseInt(String(cellE).replace(/,/g, ""));
      if (!isNaN(parsed)) mc = parsed;
    }

    rows.push({
      skuName: cellA,
      weight: cellB || "",
      category: cellC || currentCategory,
      recommendedMastercases: mc,
    });
  });

  return { rows, country, period };
}

/**
 * Main entry point: parse a Buffer containing an Excel workbook.
 * Detects single-month vs multi-month format by sheet names.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseForecastSplitExcel(buffer: any): Promise<ParsedUploadResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const sheetNames = wb.worksheets.map(ws => ws.name);

  // Multi-month format has an "Overview" sheet
  if (sheetNames.includes("Overview") || sheetNames.includes("SKU Comparison")) {
    const months: ParsedForecastMonth[] = [];

    for (const ws of wb.worksheets) {
      const name = ws.name;
      // Skip non-month sheets
      if (name === "Overview" || name === "SKU Comparison") continue;

      // Month sheet names are like "Apr 2026" or "April 2026"
      const parsed = parsePeriodLabel(name);
      if (!parsed) continue;

      const { rows, country } = parseSkuSplitSheet(ws);
      const totalMastercases = rows.reduce((s, r) => s + r.recommendedMastercases, 0);

      months.push({
        targetMonth: parsed.month,
        targetYear: parsed.year,
        country,
        totalMastercases,
        rows,
      });
    }

    // Sort months chronologically
    months.sort((a, b) => a.targetYear !== b.targetYear ? a.targetYear - b.targetYear : a.targetMonth - b.targetMonth);

    return { type: "multi", months };
  }

  // Single-month format: look for "SKU Split" sheet
  const skuWs = wb.getWorksheet("SKU Split");
  if (!skuWs) {
    throw new Error('Could not find "SKU Split" sheet in the uploaded file. Please upload an Excel file exported from the AI Forecast Split page.');
  }

  const { rows, country, period } = parseSkuSplitSheet(skuWs);
  const periodParsed = parsePeriodLabel(period);
  if (!periodParsed) {
    throw new Error(`Could not determine the target month/year from the Excel file. Found period label: "${period}"`);
  }

  const totalMastercases = rows.reduce((s, r) => s + r.recommendedMastercases, 0);

  return {
    type: "single",
    month: {
      targetMonth: periodParsed.month,
      targetYear: periodParsed.year,
      country,
      totalMastercases,
      rows,
    },
  };
}
