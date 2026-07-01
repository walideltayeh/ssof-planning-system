import ExcelJS from "exceljs";
import * as db from "./db";

// ==================== TYPES ====================
interface Sku {
  id: number;
  name: string;
  weight: string;
  category: string;
  isExcludedFromTotal: boolean | null;
  packagingType?: "Old" | "New" | null;
}
interface Period {
  id: number;
  year: number;
  month: number;
  label: string;
  sortOrder: number;
}
interface ForecastRow { skuId: number; periodId: number; value: string | null }
interface ImsRow { skuId: number; periodId: number; value: string | null; isActual: boolean | null }
interface ShipmentRow { skuId: number; periodId: number; week1: string | null; week2: string | null; week3: string | null; week4: string | null }
interface ArrivalRow { skuId: number; periodId: number; week1: string | null; week2: string | null; week3: string | null; week4: string | null }
interface PlanningFgRow { skuId: number; periodId: number; openingStock: string | null; adjustments: string | null; invoiced: string | null; arrivals: string | null }

// ==================== HELPERS ====================
const WEIGHT_ORDER: Record<string, number> = { "1kg": 0, "250g": 1, "50g": 2 };

function num(val: string | null | undefined): number {
  return parseFloat(val ?? "0") || 0;
}

function buildMap<T>(data: T[], keyFn: (d: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const d of data) map.set(keyFn(d), d);
  return map;
}

function sortSkus(skuList: Sku[]): Sku[] {
  return [...skuList].sort((a, b) => {
    const catA = a.category === "Core" ? 0 : 1;
    const catB = b.category === "Core" ? 0 : 1;
    if (catA !== catB) return catA - catB;
    const wA = WEIGHT_ORDER[a.weight] ?? 9;
    const wB = WEIGHT_ORDER[b.weight] ?? 9;
    if (wA !== wB) return wA - wB;
    return a.name.localeCompare(b.name);
  });
}

function groupSkus(skuList: Sku[]): { category: string; skus: Sku[] }[] {
  const sorted = sortSkus(skuList);
  const groups: { category: string; skus: Sku[] }[] = [];
  let currentCat = "";
  for (const sku of sorted) {
    if (sku.category !== currentCat) {
      currentCat = sku.category;
      groups.push({ category: currentCat, skus: [] });
    }
    groups[groups.length - 1].skus.push(sku);
  }
  return groups;
}

// ==================== STYLES ====================
const COLORS = {
  headerBg: "0D6B4E",
  headerFont: "FFFFFF",
  subHeaderBg: "E8F5E9",
  subtotalBg: "F0F4C3",
  grandTotalBg: "004D40",
  grandTotalFont: "FFFFFF",
  formulaCellBg: "E3F2FD",
  navBg: "1B5E20",
  navFont: "FFFFFF",
  dashboardAccent: "00897B",
  borderColor: "BDBDBD",
  cfGray: "9E9E9E",
  cfBlack: "000000",
  cfRed: "F44336",
  cfAmber: "FF9800",
  cfGreen: "4CAF50",
};

const thinBorder: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.borderColor } },
  bottom: { style: "thin", color: { argb: COLORS.borderColor } },
  left: { style: "thin", color: { argb: COLORS.borderColor } },
  right: { style: "thin", color: { argb: COLORS.borderColor } },
};

function applyHeaderStyle(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
    cell.font = { bold: true, color: { argb: COLORS.headerFont }, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = thinBorder;
  }
}

function applySubtotalStyle(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.subtotalBg } };
    cell.font = { bold: true, size: 10 };
    cell.border = thinBorder;
  }
}

function applyGrandTotalStyle(row: ExcelJS.Row, colCount: number) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.grandTotalBg } };
    cell.font = { bold: true, color: { argb: COLORS.grandTotalFont }, size: 10 };
    cell.border = {
      top: { style: "medium", color: { argb: COLORS.borderColor } },
      bottom: { style: "medium", color: { argb: COLORS.borderColor } },
      left: { style: "thin", color: { argb: COLORS.borderColor } },
      right: { style: "thin", color: { argb: COLORS.borderColor } },
    };
  }
}

function bd(cell: ExcelJS.Cell) { cell.border = thinBorder; }

function colLetter(colNum: number): string {
  let letter = "";
  let n = colNum;
  while (n > 0) { n--; letter = String.fromCharCode(65 + (n % 26)) + letter; n = Math.floor(n / 26); }
  return letter;
}

// ==================== NAVIGATION ====================
function buildNavigationSheet(wb: ExcelJS.Workbook, sheetNames: string[]) {
  const ws = wb.addWorksheet("Navigation", { properties: { tabColor: { argb: COLORS.navBg } } });

  ws.mergeCells("A1:D1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "SSOF Planning System";
  titleCell.font = { bold: true, size: 20, color: { argb: COLORS.headerFont } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navBg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 45;

  ws.mergeCells("A2:D2");
  const subCell = ws.getCell("A2");
  subCell.value = `Sales, Stock, Orders & Forecast — Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`;
  subCell.font = { size: 11, color: { argb: "666666" } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(2).height = 25;
  ws.getRow(3).height = 15;

  ws.mergeCells("A4:D4");
  const navHeader = ws.getCell("A4");
  navHeader.value = "Quick Navigation";
  navHeader.font = { bold: true, size: 14, color: { argb: COLORS.headerBg } };
  navHeader.alignment = { horizontal: "center" };
  ws.getRow(4).height = 30;

  const descriptions: Record<string, string> = {
    "Dashboard": "Summary KPIs, charts, and overview of all planning data",
    "Forecast": "Monthly sales forecast by SKU — Core and NPI categories",
    "IMS vs FRCST": "Compare actual IMS data against forecast with variance analysis",
    "Shipment (Production)": "Weekly production shipment breakdown (W1-W4) by SKU",
    "Arrival to Regie": "Weekly arrival tracking — formula-linked to Shipment with 2-week lead time",
    "Planning FG 50g": "Finished goods planning for 50g products (stock, arrivals, closing stock)",
    "Planning FG 250g": "Finished goods planning for 250g products (stock, arrivals, closing stock)",
    "Planning FG 1kg": "Finished goods planning for 1kg products (stock, arrivals, closing stock)",
  };

  let row = 6;
  for (const name of sheetNames) {
    if (name === "Navigation") continue;
    ws.getCell(`A${row}`).value = row - 5;
    ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: COLORS.headerBg } };
    ws.getCell(`A${row}`).alignment = { horizontal: "center", vertical: "middle" };
    const linkCell = ws.getCell(`B${row}`);
    linkCell.value = { text: name, hyperlink: `#'${name}'!A1` };
    linkCell.font = { bold: true, size: 12, color: { argb: "1565C0" }, underline: true };
    linkCell.alignment = { vertical: "middle" };
    ws.mergeCells(`C${row}:D${row}`);
    ws.getCell(`C${row}`).value = descriptions[name] || "";
    ws.getCell(`C${row}`).font = { size: 10, color: { argb: "666666" } };
    ws.getCell(`C${row}`).alignment = { vertical: "middle", wrapText: true };
    ws.getRow(row).height = 30;
    for (let c = 1; c <= 4; c++) bd(ws.getCell(row, c));
    row++;
  }

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 28;
  ws.getColumn(3).width = 35;
  ws.getColumn(4).width = 35;
  ws.views = [{ state: "frozen", ySplit: 5, xSplit: 0 }];
}

// ==================== DASHBOARD ====================
function buildDashboardSheet(
  wb: ExcelJS.Workbook, allSkus: Sku[], allPeriods: Period[],
  forecast: ForecastRow[], ims: ImsRow[], shipment: ShipmentRow[], sheetNames: string[]
) {
  const ws = wb.addWorksheet("Dashboard", { properties: { tabColor: { argb: COLORS.dashboardAccent } } });
  const fMap = buildMap(forecast, d => `${d.skuId}-${d.periodId}`);
  const iMap = buildMap(ims, d => `${d.skuId}-${d.periodId}`);
  const sMap = buildMap(shipment, d => `${d.skuId}-${d.periodId}`);
  const sortedPeriods = [...allPeriods].sort((a, b) => a.sortOrder - b.sortOrder);

  ws.mergeCells("A1:H1");
  const titleCell = ws.getCell("A1");
  titleCell.value = "SSOF Planning Dashboard";
  titleCell.font = { bold: true, size: 18, color: { argb: COLORS.headerFont } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 40;

  let r = 3;
  const kpiHeaders = ["Total SKUs", "50g Products", "250g Products", "1kg Products", "Core SKUs", "NPI SKUs", "Periods Tracked", "Years"];
  const kpiValues = [
    allSkus.length,
    allSkus.filter(s => s.weight === "50g").length,
    allSkus.filter(s => s.weight === "250g").length,
    allSkus.filter(s => s.weight === "1kg").length,
    allSkus.filter(s => s.category === "Core").length,
    allSkus.filter(s => s.category === "NPI").length,
    allPeriods.length,
    new Set(allPeriods.map(p => p.year)).size,
  ];
  for (let i = 0; i < kpiHeaders.length; i++) {
    const col = i + 1;
    const hCell = ws.getCell(r, col);
    hCell.value = kpiHeaders[i];
    hCell.font = { bold: true, size: 10, color: { argb: COLORS.headerFont } };
    hCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.dashboardAccent } };
    hCell.alignment = { horizontal: "center" };
    bd(hCell);
    const vCell = ws.getCell(r + 1, col);
    vCell.value = kpiValues[i];
    vCell.font = { bold: true, size: 16 };
    vCell.alignment = { horizontal: "center" };
    bd(vCell);
  }
  r += 3;

  // Monthly summary table
  const summaryHeaders = ["Month", "Total Forecast", "Total IMS", "Variance", "Variance %", "Total Shipment"];
  r++;
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "Monthly Forecast Summary (All SKUs)";
  ws.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: COLORS.headerBg } };
  r++;
  for (let i = 0; i < summaryHeaders.length; i++) {
    const cell = ws.getCell(r, i + 1);
    cell.value = summaryHeaders[i];
    cell.font = { bold: true, color: { argb: COLORS.headerFont }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.headerBg } };
    cell.alignment = { horizontal: "center" };
    bd(cell);
  }
  r++;

  for (const p of sortedPeriods) {
    let totalF = 0, totalI = 0, totalS = 0;
    for (const sku of allSkus) {
      totalF += num(fMap.get(`${sku.id}-${p.id}`)?.value);
      totalI += num(iMap.get(`${sku.id}-${p.id}`)?.value);
      const sd = sMap.get(`${sku.id}-${p.id}`);
      totalS += num(sd?.week1) + num(sd?.week2) + num(sd?.week3) + num(sd?.week4);
    }
    const variance = totalI - totalF;
    const variancePct = totalF !== 0 ? Math.round((variance / totalF) * 1000) / 10 : 0;
    const cells = [p.label, totalF, totalI, variance, variancePct, totalS];
    for (let i = 0; i < cells.length; i++) {
      const cell = ws.getCell(r, i + 1);
      cell.value = cells[i];
      if (i >= 1) cell.numFmt = i === 4 ? '0.0' : '#,##0';
      bd(cell);
      if (i === 3 || i === 4) {
        cell.font = { bold: true, color: { argb: (cells[i] as number) < 0 ? COLORS.cfRed : COLORS.cfGreen } };
      }
    }
    r++;
  }

  r += 2;
  ws.mergeCells(`A${r}:H${r}`);
  ws.getCell(`A${r}`).value = "Quick Links to Sheets";
  ws.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: COLORS.headerBg } };
  r++;
  for (const name of sheetNames) {
    if (name === "Navigation" || name === "Dashboard") continue;
    const cell = ws.getCell(`A${r}`);
    cell.value = { text: `→ ${name}`, hyperlink: `#'${name}'!A1` };
    cell.font = { color: { argb: "1565C0" }, underline: true, size: 11 };
    r++;
  }
  for (let c = 1; c <= 8; c++) ws.getColumn(c).width = 16;
  ws.getColumn(1).width = 12;
  ws.views = [{ state: "frozen", ySplit: 2, xSplit: 0 }];
}

// ==================== FORECAST ====================
// Returns skuRowMap: skuId -> row number in Forecast sheet
function buildForecastSheet(
  wb: ExcelJS.Workbook, allSkus: Sku[], sortedPeriods: Period[], forecast: ForecastRow[]
): { skuRowMap: Map<number, number> } {
  const ws = wb.addWorksheet("Forecast", { properties: { tabColor: { argb: "2E7D32" } } });
  const fMap = buildMap(forecast, d => `${d.skuId}-${d.periodId}`);
  const groups = groupSkus(allSkus);
  const totalCols = 3 + sortedPeriods.length;
  const skuRowMap = new Map<number, number>();

  const headerRow = ws.getRow(1);
  headerRow.getCell(1).value = "Category";
  headerRow.getCell(2).value = "Weight";
  headerRow.getCell(3).value = "SKU Name";
  for (let i = 0; i < sortedPeriods.length; i++) {
    headerRow.getCell(4 + i).value = sortedPeriods[i].label;
  }
  applyHeaderStyle(headerRow, totalCols);
  ws.getRow(1).height = 22;

  let r = 2;
  const allDataRows: number[] = [];
  const includedRows: number[] = [];
  for (const group of groups) {
    for (const sku of group.skus) {
      skuRowMap.set(sku.id, r);
      allDataRows.push(r);
      if (!sku.isExcludedFromTotal) includedRows.push(r);
      const row = ws.getRow(r);
      row.getCell(1).value = sku.category;
      row.getCell(2).value = sku.weight;
      row.getCell(3).value = sku.name;
      for (let i = 0; i < sortedPeriods.length; i++) {
        const cell = row.getCell(4 + i);
        cell.value = num(fMap.get(`${sku.id}-${sortedPeriods[i].id}`)?.value);
        cell.numFmt = '#,##0';
        bd(cell);
      }
      for (let c = 1; c <= 3; c++) bd(row.getCell(c));
      r++;
    }

    // Subtotal
    const subRow = ws.getRow(r);
    subRow.getCell(3).value = `Subtotal ${group.category}`;
    const firstR = r - group.skus.length;
    const lastR = r - 1;
    for (let i = 0; i < sortedPeriods.length; i++) {
      const col = colLetter(4 + i);
      subRow.getCell(4 + i).value = { formula: `SUM(${col}${firstR}:${col}${lastR})` };
      subRow.getCell(4 + i).numFmt = '#,##0';
    }
    applySubtotalStyle(subRow, totalCols);
    r++;
  }

  // Grand total (without excluded)
  const totalRow = ws.getRow(r);
  totalRow.getCell(3).value = "GRAND TOTAL";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const col = colLetter(4 + i);
    const parts = includedRows.map(rr => `${col}${rr}`).join("+");
    totalRow.getCell(4 + i).value = { formula: parts || "0" };
    totalRow.getCell(4 + i).numFmt = '#,##0';
  }
  applyGrandTotalStyle(totalRow, totalCols);
  r++;

  // Grand total (all)
  if (includedRows.length !== allDataRows.length) {
    const totalAllRow = ws.getRow(r);
    totalAllRow.getCell(3).value = "GRAND TOTAL (All SKUs)";
    for (let i = 0; i < sortedPeriods.length; i++) {
      const col = colLetter(4 + i);
      const parts = allDataRows.map(rr => `${col}${rr}`).join("+");
      totalAllRow.getCell(4 + i).value = { formula: parts };
      totalAllRow.getCell(4 + i).numFmt = '#,##0';
    }
    applyGrandTotalStyle(totalAllRow, totalCols);
    r++;
  }

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 8;
  ws.getColumn(3).width = 32;
  for (let i = 0; i < sortedPeriods.length; i++) ws.getColumn(4 + i).width = 10;
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];

  const backCell = ws.getCell(`A${r + 1}`);
  backCell.value = { text: "← Back to Navigation", hyperlink: "#'Navigation'!A1" };
  backCell.font = { color: { argb: "1565C0" }, underline: true };

  return { skuRowMap };
}

// ==================== IMS vs FRCST ====================
// Returns: skuForecastRowMap (skuId -> forecast row), skuImsRowMap (skuId -> IMS row)
function buildImsVsForecastSheet(
  wb: ExcelJS.Workbook, allSkus: Sku[], sortedPeriods: Period[],
  forecast: ForecastRow[], ims: ImsRow[],
  forecastSheetSkuRowMap: Map<number, number>
): { skuForecastRowMap: Map<number, number>; skuImsRowMap: Map<number, number> } {
  const ws = wb.addWorksheet("IMS vs FRCST", { properties: { tabColor: { argb: "F57F17" } } });
  const iMap = buildMap(ims, d => `${d.skuId}-${d.periodId}`);
  const groups = groupSkus(allSkus);
  const totalCols = 4 + sortedPeriods.length;

  const skuForecastRowMap = new Map<number, number>();
  const skuImsRowMap = new Map<number, number>();

  const headerRow = ws.getRow(1);
  headerRow.getCell(1).value = "Category";
  headerRow.getCell(2).value = "Weight";
  headerRow.getCell(3).value = "SKU Name";
  headerRow.getCell(4).value = "Row";
  for (let i = 0; i < sortedPeriods.length; i++) {
    headerRow.getCell(5 + i).value = sortedPeriods[i].label;
  }
  applyHeaderStyle(headerRow, totalCols);

  let r = 2;
  const allForecastRows: number[] = [];
  const allImsRows: number[] = [];
  const allVarianceRows: number[] = [];
  const includedForecastRows: number[] = [];
  const includedImsRows: number[] = [];
  const includedVarianceRows: number[] = [];

  for (const group of groups) {
    for (const sku of group.skus) {
      const forecastSheetRow = forecastSheetSkuRowMap.get(sku.id);

      // Forecast row — FORMULA referencing Forecast sheet
      const fRow = ws.getRow(r);
      fRow.getCell(1).value = sku.category;
      fRow.getCell(2).value = sku.weight;
      fRow.getCell(3).value = sku.name;
      fRow.getCell(4).value = "Forecast";
      for (let i = 0; i < sortedPeriods.length; i++) {
        const cell = fRow.getCell(5 + i);
        if (forecastSheetRow) {
          // Cross-sheet formula to Forecast sheet
          const fCol = colLetter(4 + i); // Forecast sheet uses col 4+i
          cell.value = { formula: `'Forecast'!${fCol}${forecastSheetRow}` };
        } else {
          cell.value = 0;
        }
        cell.numFmt = '#,##0';
        bd(cell);
      }
      for (let c = 1; c <= 4; c++) bd(fRow.getCell(c));
      skuForecastRowMap.set(sku.id, r);
      allForecastRows.push(r);
      if (!sku.isExcludedFromTotal) includedForecastRows.push(r);
      const forecastRowNum = r;
      r++;

      // IMS row — raw values
      const iRow = ws.getRow(r);
      iRow.getCell(4).value = "IMS";
      for (let i = 0; i < sortedPeriods.length; i++) {
        const cell = iRow.getCell(5 + i);
        cell.value = num(iMap.get(`${sku.id}-${sortedPeriods[i].id}`)?.value);
        cell.numFmt = '#,##0';
        bd(cell);
      }
      for (let c = 1; c <= 4; c++) bd(iRow.getCell(c));
      skuImsRowMap.set(sku.id, r);
      allImsRows.push(r);
      if (!sku.isExcludedFromTotal) includedImsRows.push(r);
      const imsRowNum = r;
      r++;

      // Variance row — FORMULA: IMS - Forecast (within sheet)
      const vRow = ws.getRow(r);
      vRow.getCell(4).value = "Variance";
      for (let i = 0; i < sortedPeriods.length; i++) {
        const col = colLetter(5 + i);
        const cell = vRow.getCell(5 + i);
        cell.value = { formula: `${col}${imsRowNum}-${col}${forecastRowNum}` };
        cell.numFmt = '#,##0';
        bd(cell);
      }
      for (let c = 1; c <= 4; c++) bd(vRow.getCell(c));
      allVarianceRows.push(r);
      if (!sku.isExcludedFromTotal) includedVarianceRows.push(r);
      r++;
    }

    // Category subtotals
    const catFRows = group.skus.map(s => skuForecastRowMap.get(s.id)!);
    const catIRows = group.skus.map(s => skuImsRowMap.get(s.id)!);

    const subFRow = ws.getRow(r);
    subFRow.getCell(3).value = `Subtotal ${group.category}`;
    subFRow.getCell(4).value = "Forecast";
    for (let i = 0; i < sortedPeriods.length; i++) {
      const col = colLetter(5 + i);
      subFRow.getCell(5 + i).value = { formula: catFRows.map(rr => `${col}${rr}`).join("+") };
      subFRow.getCell(5 + i).numFmt = '#,##0';
    }
    applySubtotalStyle(subFRow, totalCols);
    r++;

    const subIRow = ws.getRow(r);
    subIRow.getCell(4).value = "IMS";
    for (let i = 0; i < sortedPeriods.length; i++) {
      const col = colLetter(5 + i);
      subIRow.getCell(5 + i).value = { formula: catIRows.map(rr => `${col}${rr}`).join("+") };
      subIRow.getCell(5 + i).numFmt = '#,##0';
    }
    applySubtotalStyle(subIRow, totalCols);
    r++;

    const subVRow = ws.getRow(r);
    subVRow.getCell(4).value = "Variance";
    for (let i = 0; i < sortedPeriods.length; i++) {
      const col = colLetter(5 + i);
      subVRow.getCell(5 + i).value = { formula: `${col}${r - 1}-${col}${r - 2}` };
      subVRow.getCell(5 + i).numFmt = '#,##0';
    }
    applySubtotalStyle(subVRow, totalCols);
    r++;
  }

  // Grand total (without excluded)
  const gtFRow = ws.getRow(r);
  gtFRow.getCell(3).value = "GRAND TOTAL";
  gtFRow.getCell(4).value = "Forecast";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const col = colLetter(5 + i);
    gtFRow.getCell(5 + i).value = { formula: includedForecastRows.map(rr => `${col}${rr}`).join("+") || "0" };
    gtFRow.getCell(5 + i).numFmt = '#,##0';
  }
  applyGrandTotalStyle(gtFRow, totalCols);
  r++;

  const gtIRow = ws.getRow(r);
  gtIRow.getCell(4).value = "IMS";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const col = colLetter(5 + i);
    gtIRow.getCell(5 + i).value = { formula: includedImsRows.map(rr => `${col}${rr}`).join("+") || "0" };
    gtIRow.getCell(5 + i).numFmt = '#,##0';
  }
  applyGrandTotalStyle(gtIRow, totalCols);
  r++;

  const gtVRow = ws.getRow(r);
  gtVRow.getCell(4).value = "Variance";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const col = colLetter(5 + i);
    gtVRow.getCell(5 + i).value = { formula: `${col}${r - 1}-${col}${r - 2}` };
    gtVRow.getCell(5 + i).numFmt = '#,##0';
  }
  applyGrandTotalStyle(gtVRow, totalCols);
  r++;

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 8;
  ws.getColumn(3).width = 32;
  ws.getColumn(4).width = 10;
  for (let i = 0; i < sortedPeriods.length; i++) ws.getColumn(5 + i).width = 10;
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 4 }];

  const backCell = ws.getCell(`A${r + 1}`);
  backCell.value = { text: "← Back to Navigation", hyperlink: "#'Navigation'!A1" };
  backCell.font = { color: { argb: "1565C0" }, underline: true };

  return { skuForecastRowMap, skuImsRowMap };
}

// ==================== SHIPMENT ====================
function buildShipmentSheet(
  wb: ExcelJS.Workbook, allSkus: Sku[], sortedPeriods: Period[], shipment: ShipmentRow[]
): { sheetName: string; skuRowMap: Map<number, number>; periodColMap: Map<number, number> } {
  const sheetName = "Shipment (Production)";
  const ws = wb.addWorksheet(sheetName, { properties: { tabColor: { argb: "1565C0" } } });
  const sMap = buildMap(shipment, d => `${d.skuId}-${d.periodId}`);
  const groups = groupSkus(allSkus);
  const totalCols = 3 + sortedPeriods.length * 5;

  const headerRow1 = ws.getRow(1);
  headerRow1.getCell(1).value = "Category";
  headerRow1.getCell(2).value = "Weight";
  headerRow1.getCell(3).value = "SKU Name";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const startCol = 4 + i * 5;
    headerRow1.getCell(startCol).value = sortedPeriods[i].label;
    ws.mergeCells(1, startCol, 1, startCol + 4);
  }
  applyHeaderStyle(headerRow1, totalCols);

  const headerRow2 = ws.getRow(2);
  for (let i = 0; i < sortedPeriods.length; i++) {
    const startCol = 4 + i * 5;
    headerRow2.getCell(startCol).value = "W1";
    headerRow2.getCell(startCol + 1).value = "W2";
    headerRow2.getCell(startCol + 2).value = "W3";
    headerRow2.getCell(startCol + 3).value = "W4";
    headerRow2.getCell(startCol + 4).value = "Total";
  }
  applyHeaderStyle(headerRow2, totalCols);

  const skuRowMap = new Map<number, number>();
  const periodColMap = new Map<number, number>();
  for (let i = 0; i < sortedPeriods.length; i++) {
    periodColMap.set(sortedPeriods[i].id, 4 + i * 5);
  }

  let r = 3;
  const allDataRows: number[] = [];
  const includedRows: number[] = [];
  for (const group of groups) {
    for (const sku of group.skus) {
      skuRowMap.set(sku.id, r);
      allDataRows.push(r);
      if (!sku.isExcludedFromTotal) includedRows.push(r);
      const row = ws.getRow(r);
      row.getCell(1).value = sku.category;
      row.getCell(2).value = sku.weight;
      row.getCell(3).value = sku.name;
      for (let c = 1; c <= 3; c++) bd(row.getCell(c));

      for (let i = 0; i < sortedPeriods.length; i++) {
        const startCol = 4 + i * 5;
        const d = sMap.get(`${sku.id}-${sortedPeriods[i].id}`);
        row.getCell(startCol).value = num(d?.week1);
        row.getCell(startCol + 1).value = num(d?.week2);
        row.getCell(startCol + 2).value = num(d?.week3);
        row.getCell(startCol + 3).value = num(d?.week4);
        // Total = SUM formula
        const cl = colLetter(startCol);
        const cl4 = colLetter(startCol + 3);
        row.getCell(startCol + 4).value = { formula: `SUM(${cl}${r}:${cl4}${r})` };
        for (let c = startCol; c <= startCol + 4; c++) {
          row.getCell(c).numFmt = '#,##0';
          bd(row.getCell(c));
        }
      }
      r++;
    }

    // Subtotal
    const subRow = ws.getRow(r);
    subRow.getCell(3).value = `Subtotal ${group.category}`;
    const firstR = r - group.skus.length;
    const lastR = r - 1;
    for (let i = 0; i < sortedPeriods.length; i++) {
      const startCol = 4 + i * 5;
      for (let w = 0; w < 5; w++) {
        const col = colLetter(startCol + w);
        subRow.getCell(startCol + w).value = { formula: `SUM(${col}${firstR}:${col}${lastR})` };
        subRow.getCell(startCol + w).numFmt = '#,##0';
      }
    }
    applySubtotalStyle(subRow, totalCols);
    r++;
  }

  // Grand total
  const totalRow = ws.getRow(r);
  totalRow.getCell(3).value = "GRAND TOTAL";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const startCol = 4 + i * 5;
    for (let w = 0; w < 5; w++) {
      const col = colLetter(startCol + w);
      const parts = includedRows.map(rr => `${col}${rr}`).join("+");
      totalRow.getCell(startCol + w).value = { formula: parts || "0" };
      totalRow.getCell(startCol + w).numFmt = '#,##0';
    }
  }
  applyGrandTotalStyle(totalRow, totalCols);

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 8;
  ws.getColumn(3).width = 32;
  for (let i = 0; i < sortedPeriods.length * 5; i++) ws.getColumn(4 + i).width = 9;
  ws.views = [{ state: "frozen", ySplit: 2, xSplit: 3 }];

  const backCell = ws.getCell(`A${r + 2}`);
  backCell.value = { text: "← Back to Navigation", hyperlink: "#'Navigation'!A1" };
  backCell.font = { color: { argb: "1565C0" }, underline: true };

  return { sheetName, skuRowMap, periodColMap };
}

// ==================== ARRIVAL TO REGIE ====================
function buildArrivalSheet(
  wb: ExcelJS.Workbook, allSkus: Sku[], sortedPeriods: Period[],
  arrival: ArrivalRow[], shipment: ShipmentRow[],
  shipmentSheetName: string, shipSkuRowMap: Map<number, number>, shipPeriodColMap: Map<number, number>
): { skuRowMap: Map<number, number>; periodTotalColMap: Map<number, number> } {
  const ws = wb.addWorksheet("Arrival to Regie", { properties: { tabColor: { argb: "6A1B9A" } } });
  const aMap = buildMap(arrival, d => `${d.skuId}-${d.periodId}`);
  const groups = groupSkus(allSkus);
  const totalCols = 3 + sortedPeriods.length * 5;

  const periodByYM = new Map<string, Period>();
  for (const p of sortedPeriods) periodByYM.set(`${p.year}-${p.month}`, p);

  const headerRow1 = ws.getRow(1);
  headerRow1.getCell(1).value = "Category";
  headerRow1.getCell(2).value = "Weight";
  headerRow1.getCell(3).value = "SKU Name";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const startCol = 4 + i * 5;
    headerRow1.getCell(startCol).value = sortedPeriods[i].label;
    ws.mergeCells(1, startCol, 1, startCol + 4);
  }
  applyHeaderStyle(headerRow1, totalCols);

  const headerRow2 = ws.getRow(2);
  for (let i = 0; i < sortedPeriods.length; i++) {
    const startCol = 4 + i * 5;
    headerRow2.getCell(startCol).value = "W1";
    headerRow2.getCell(startCol + 1).value = "W2";
    headerRow2.getCell(startCol + 2).value = "W3";
    headerRow2.getCell(startCol + 3).value = "W4";
    headerRow2.getCell(startCol + 4).value = "Total";
  }
  applyHeaderStyle(headerRow2, totalCols);

  const arrSkuRowMap = new Map<number, number>();
  const arrPeriodTotalColMap = new Map<number, number>();
  for (let i = 0; i < sortedPeriods.length; i++) {
    arrPeriodTotalColMap.set(sortedPeriods[i].id, 4 + i * 5 + 4); // Total column
  }

  let r = 3;
  const allDataRows: number[] = [];
  const includedRows: number[] = [];
  for (const group of groups) {
    for (const sku of group.skus) {
      arrSkuRowMap.set(sku.id, r);
      allDataRows.push(r);
      if (!sku.isExcludedFromTotal) includedRows.push(r);
      const row = ws.getRow(r);
      row.getCell(1).value = sku.category;
      row.getCell(2).value = sku.weight;
      row.getCell(3).value = sku.name;
      for (let c = 1; c <= 3; c++) bd(row.getCell(c));

      const shipRow = shipSkuRowMap.get(sku.id);

      for (let i = 0; i < sortedPeriods.length; i++) {
        const p = sortedPeriods[i];
        const startCol = 4 + i * 5;
        const { year, month } = p;
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prevPeriod = periodByYM.get(`${prevYear}-${prevMonth}`);

        const isFullFormula = year > 2026 || (year === 2026 && month >= 2);
        const isPartialJan26 = year === 2026 && month === 1;
        const isPartialDec25 = year === 2025 && month === 12;

        const shipRef = (prd: Period | undefined, weekOffset: number): string | null => {
          if (!prd || !shipRow) return null;
          const shipCol = shipPeriodColMap.get(prd.id);
          if (!shipCol) return null;
          return `'${shipmentSheetName}'!${colLetter(shipCol + weekOffset)}${shipRow}`;
        };

        for (let w = 0; w < 4; w++) {
          const cell = row.getCell(startCol + w);
          let useFormula = false;

          if (isFullFormula) {
            let ref: string | null = null;
            if (w === 0) ref = shipRef(prevPeriod, 2);
            else if (w === 1) ref = shipRef(prevPeriod, 3);
            else if (w === 2) ref = shipRef(p, 0);
            else if (w === 3) ref = shipRef(p, 1);
            if (ref) { cell.value = { formula: ref }; useFormula = true; }
          } else if (isPartialJan26 && (w === 2 || w === 3)) {
            const ref = shipRef(p, w === 2 ? 0 : 1);
            if (ref) { cell.value = { formula: ref }; useFormula = true; }
          } else if (isPartialDec25 && w === 3) {
            const ref = shipRef(p, 1);
            if (ref) { cell.value = { formula: ref }; useFormula = true; }
          }

          if (!useFormula) {
            const d = aMap.get(`${sku.id}-${p.id}`);
            const weekKeys = ['week1', 'week2', 'week3', 'week4'] as const;
            cell.value = num(d?.[weekKeys[w]]);
          }

          cell.numFmt = '#,##0';
          bd(cell);
          if (useFormula) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.formulaCellBg } };
          }
        }

        // Total = SUM(W1:W4)
        const totalCell = row.getCell(startCol + 4);
        const cl = colLetter(startCol);
        const cl4 = colLetter(startCol + 3);
        totalCell.value = { formula: `SUM(${cl}${r}:${cl4}${r})` };
        totalCell.numFmt = '#,##0';
        bd(totalCell);
      }
      r++;
    }

    // Subtotal
    const subRow = ws.getRow(r);
    subRow.getCell(3).value = `Subtotal ${group.category}`;
    const firstR = r - group.skus.length;
    const lastR = r - 1;
    for (let i = 0; i < sortedPeriods.length; i++) {
      const startCol = 4 + i * 5;
      for (let w = 0; w < 5; w++) {
        const col = colLetter(startCol + w);
        subRow.getCell(startCol + w).value = { formula: `SUM(${col}${firstR}:${col}${lastR})` };
        subRow.getCell(startCol + w).numFmt = '#,##0';
      }
    }
    applySubtotalStyle(subRow, totalCols);
    r++;
  }

  // Grand total
  const totalRow = ws.getRow(r);
  totalRow.getCell(3).value = "GRAND TOTAL";
  for (let i = 0; i < sortedPeriods.length; i++) {
    const startCol = 4 + i * 5;
    for (let w = 0; w < 5; w++) {
      const col = colLetter(startCol + w);
      const parts = includedRows.map(rr => `${col}${rr}`).join("+");
      totalRow.getCell(startCol + w).value = { formula: parts || "0" };
      totalRow.getCell(startCol + w).numFmt = '#,##0';
    }
  }
  applyGrandTotalStyle(totalRow, totalCols);

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 8;
  ws.getColumn(3).width = 32;
  for (let i = 0; i < sortedPeriods.length * 5; i++) ws.getColumn(4 + i).width = 9;
  ws.views = [{ state: "frozen", ySplit: 2, xSplit: 3 }];

  const backCell = ws.getCell(`A${r + 2}`);
  backCell.value = { text: "← Back to Navigation", hyperlink: "#'Navigation'!A1" };
  backCell.font = { color: { argb: "1565C0" }, underline: true };

  return { skuRowMap: arrSkuRowMap, periodTotalColMap: arrPeriodTotalColMap };
}

// ==================== PLANNING FG ====================
function buildPlanningFgSheet(
  wb: ExcelJS.Workbook, weight: string, allSkus: Sku[], sortedPeriods: Period[],
  ims: ImsRow[], planningFg: PlanningFgRow[],
  // Cross-sheet references
  imsVsFrcstSheetName: string,
  imsVsFrcstImsRowMap: Map<number, number>,  // skuId -> IMS row in IMS vs FRCST
  shipmentSheetName: string,
  shipSkuRowMap: Map<number, number>,
  shipPeriodColMap: Map<number, number>,      // periodId -> W1 col in Shipment
  arrivalSheetName: string,
  arrSkuRowMap: Map<number, number>,
  arrPeriodTotalColMap: Map<number, number>   // periodId -> Total col in Arrival
) {
  const tabColors: Record<string, string> = { "50g": "E65100", "250g": "AD1457", "1kg": "4527A0" };
  const ws = wb.addWorksheet(`Planning FG ${weight}`, { properties: { tabColor: { argb: tabColors[weight] || "000000" } } });

  const filteredSkus = allSkus.filter(s => s.weight === weight);
  const sorted = [...filteredSkus].sort((a, b) => {
    const catA = a.category === "Core" ? 0 : 1;
    const catB = b.category === "Core" ? 0 : 1;
    if (catA !== catB) return catA - catB;
    return a.name.localeCompare(b.name);
  });

  const iMap = buildMap(ims, d => `${d.skuId}-${d.periodId}`);
  const pMap = buildMap(planningFg, d => `${d.skuId}-${d.periodId}`);

  const ROW_LABELS = [
    "Opening Stock",
    "Adjustments",
    "IMS",
    "Invoiced (SHP)",
    "Actual arrivals / Planned Orders",
    "Closing Stock",
    "Closing Stock - Weeks",
  ];

  const totalCols = 3 + sortedPeriods.length;

  const headerRow = ws.getRow(1);
  headerRow.getCell(1).value = "Category";
  headerRow.getCell(2).value = "SKU Name";
  headerRow.getCell(3).value = "Row";
  for (let i = 0; i < sortedPeriods.length; i++) {
    headerRow.getCell(4 + i).value = sortedPeriods[i].label;
  }
  applyHeaderStyle(headerRow, totalCols);

  let r = 2;
  for (const sku of sorted) {
    const openingStockRow = r;
    const adjustmentsRow = r + 1;
    const imsRow = r + 2;
    const invoicedRow = r + 3;
    const arrivalsRow = r + 4;
    const closingStockRow = r + 5;
    const weeksRow = r + 6;

    // Write labels
    for (let lr = 0; lr < ROW_LABELS.length; lr++) {
      const row = ws.getRow(r + lr);
      if (lr === 0) {
        row.getCell(1).value = sku.category;
        row.getCell(2).value = sku.name;
      }
      row.getCell(3).value = ROW_LABELS[lr];
      for (let c = 1; c <= 3; c++) bd(row.getCell(c));
    }

    // Cross-sheet row references
    const imsVsFrcstImsRow = imsVsFrcstImsRowMap.get(sku.id);
    const shipRow = shipSkuRowMap.get(sku.id);
    const arrRow = arrSkuRowMap.get(sku.id);

    for (let i = 0; i < sortedPeriods.length; i++) {
      const p = sortedPeriods[i];
      const col = colLetter(4 + i);
      const planData = pMap.get(`${sku.id}-${p.id}`);

      // Opening Stock: first month = raw, rest = previous Closing Stock
      const osCell = ws.getCell(openingStockRow, 4 + i);
      if (i === 0) {
        osCell.value = num(planData?.openingStock);
      } else {
        const prevCol = colLetter(4 + i - 1);
        osCell.value = { formula: `${prevCol}${closingStockRow}` };
      }
      osCell.numFmt = '#,##0';
      bd(osCell);

      // Adjustments: raw values
      const adjCell = ws.getCell(adjustmentsRow, 4 + i);
      adjCell.value = num(planData?.adjustments);
      adjCell.numFmt = '#,##0';
      bd(adjCell);

      // IMS: FORMULA referencing IMS vs FRCST sheet (IMS row, not Forecast row)
      const imsCell = ws.getCell(imsRow, 4 + i);
      if (imsVsFrcstImsRow) {
        const imsCol = colLetter(5 + i); // IMS vs FRCST uses col 5+i (has extra "Row" column)
        imsCell.value = { formula: `'${imsVsFrcstSheetName}'!${imsCol}${imsVsFrcstImsRow}` };
      } else {
        imsCell.value = num(iMap.get(`${sku.id}-${p.id}`)?.value);
      }
      imsCell.numFmt = '#,##0';
      bd(imsCell);

      // Invoiced (SHP): FORMULA referencing Shipment Total column
      const invCell = ws.getCell(invoicedRow, 4 + i);
      const shipTotalCol = shipPeriodColMap.get(p.id);
      if (shipRow && shipTotalCol !== undefined) {
        // Total column = W1 col + 4
        const shipTotalColLetter = colLetter(shipTotalCol + 4);
        invCell.value = { formula: `'${shipmentSheetName}'!${shipTotalColLetter}${shipRow}` };
      } else {
        invCell.value = num(planData?.invoiced);
      }
      invCell.numFmt = '#,##0';
      bd(invCell);

      // Arrivals: FORMULA referencing Arrival to Regie Total column
      const arrCell = ws.getCell(arrivalsRow, 4 + i);
      const arrTotalCol = arrPeriodTotalColMap.get(p.id);
      if (arrRow && arrTotalCol !== undefined) {
        const arrTotalColLetter = colLetter(arrTotalCol);
        arrCell.value = { formula: `'${arrivalSheetName}'!${arrTotalColLetter}${arrRow}` };
      } else {
        arrCell.value = num(planData?.arrivals);
      }
      arrCell.numFmt = '#,##0';
      bd(arrCell);

      // Closing Stock = Opening + Adjustments + Arrivals - IMS
      const csCell = ws.getCell(closingStockRow, 4 + i);
      csCell.value = { formula: `${col}${openingStockRow}+${col}${adjustmentsRow}+${col}${arrivalsRow}-${col}${imsRow}` };
      csCell.numFmt = '#,##0';
      csCell.font = { bold: true };
      bd(csCell);

      // Closing Stock - Weeks = IF(CS=0,0,IFERROR((CS/AVG(next2IMS))*4.3,"∞"))
      const wkCell = ws.getCell(weeksRow, 4 + i);
      if (i < sortedPeriods.length - 2) {
        const nextCol1 = colLetter(4 + i + 1);
        const nextCol2 = colLetter(4 + i + 2);
        wkCell.value = {
          formula: `IF(${col}${closingStockRow}=0,0,IFERROR((${col}${closingStockRow}/AVERAGE(${nextCol1}${imsRow},${nextCol2}${imsRow}))*4.3,0))`
        };
      } else if (i < sortedPeriods.length - 1) {
        const nextCol1 = colLetter(4 + i + 1);
        wkCell.value = {
          formula: `IF(${col}${closingStockRow}=0,0,IF(${nextCol1}${imsRow}=0,0,(${col}${closingStockRow}/${nextCol1}${imsRow})*4.3))`
        };
      } else {
        wkCell.value = 0;
      }
      wkCell.numFmt = '0.00';
      bd(wkCell);

      // Conditional formatting for Weeks cell
      const computedWeeks = computeWeeksValue(sku.id, i, sortedPeriods, iMap, pMap);
      if (computedWeeks === 0) {
        wkCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "E0E0E0" } };
        wkCell.font = { color: { argb: COLORS.cfGray } };
      } else if (computedWeeks < 0) {
        wkCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "212121" } };
        wkCell.font = { color: { argb: "FFFFFF" }, bold: true };
      } else if (computedWeeks < 4) {
        wkCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCDD2" } };
        wkCell.font = { color: { argb: COLORS.cfRed }, bold: true };
      } else if (computedWeeks <= 6) {
        wkCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3E0" } };
        wkCell.font = { color: { argb: COLORS.cfAmber }, bold: true };
      } else {
        wkCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCDD2" } };
        wkCell.font = { color: { argb: COLORS.cfRed }, bold: true };
      }
    }

    r += ROW_LABELS.length;
    r++; // separator
  }

  ws.getColumn(1).width = 10;
  ws.getColumn(2).width = 32;
  ws.getColumn(3).width = 30;
  for (let i = 0; i < sortedPeriods.length; i++) ws.getColumn(4 + i).width = 11;
  ws.views = [{ state: "frozen", ySplit: 1, xSplit: 3 }];

  const backCell = ws.getCell(`A${r + 1}`);
  backCell.value = { text: "← Back to Navigation", hyperlink: "#'Navigation'!A1" };
  backCell.font = { color: { argb: "1565C0" }, underline: true };
}

function computeWeeksValue(
  skuId: number, periodIdx: number, sortedPeriods: Period[],
  iMap: Map<string, ImsRow>, pMap: Map<string, PlanningFgRow>
): number {
  let prevClosing = 0;
  for (let i = 0; i <= periodIdx; i++) {
    const p = sortedPeriods[i];
    const planData = pMap.get(`${skuId}-${p.id}`);
    const imsVal = num(iMap.get(`${skuId}-${p.id}`)?.value);
    const opening = i === 0 ? num(planData?.openingStock) : prevClosing;
    const adj = num(planData?.adjustments);
    const arr = num(planData?.arrivals);
    prevClosing = opening + adj - imsVal + arr;
  }
  const closingStock = prevClosing;
  if (closingStock === 0) return 0;
  if (periodIdx < sortedPeriods.length - 2) {
    const next1 = num(iMap.get(`${skuId}-${sortedPeriods[periodIdx + 1].id}`)?.value);
    const next2 = num(iMap.get(`${skuId}-${sortedPeriods[periodIdx + 2].id}`)?.value);
    const avg = (next1 + next2) / 2;
    if (avg > 0) return (closingStock / avg) * 4.3;
  } else if (periodIdx < sortedPeriods.length - 1) {
    const next1 = num(iMap.get(`${skuId}-${sortedPeriods[periodIdx + 1].id}`)?.value);
    if (next1 > 0) return (closingStock / next1) * 4.3;
  }
  return 0;
}

// ==================== SINGLE-SHEET EXPORT ====================
export async function generateSingleSheetBuffer(sheet: string): Promise<Buffer> {
  const data = await db.getFullPlanningData();
  const { skus: allSkus, periods: allPeriods, forecast, ims, shipment, arrival, planningFg } = data;
  const sortedPeriods = [...allPeriods].sort((a, b) => a.sortOrder - b.sortOrder);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();

  if (sheet === "forecast") {
    buildForecastSheet(wb, allSkus, sortedPeriods, forecast);
  } else if (sheet === "ims") {
    const { skuRowMap: forecastSkuRowMap } = buildForecastSheet(wb, allSkus, sortedPeriods, forecast);
    buildImsVsForecastSheet(wb, allSkus, sortedPeriods, forecast, ims, forecastSkuRowMap);
  } else if (sheet === "shipment") {
    buildShipmentSheet(wb, allSkus, sortedPeriods, shipment);
  } else if (sheet === "arrival") {
    const { sheetName: shipSheetName, skuRowMap: shipSkuRowMap, periodColMap: shipPeriodColMap } =
      buildShipmentSheet(wb, allSkus, sortedPeriods, shipment);
    buildArrivalSheet(wb, allSkus, sortedPeriods, arrival, shipment, shipSheetName, shipSkuRowMap, shipPeriodColMap);
  } else if (sheet.startsWith("planning-fg-")) {
    const weight = sheet.replace("planning-fg-", "");
    const { skuRowMap: forecastSkuRowMap } = buildForecastSheet(wb, allSkus, sortedPeriods, forecast);
    const { skuImsRowMap: imsFrcstImsRowMap } =
      buildImsVsForecastSheet(wb, allSkus, sortedPeriods, forecast, ims, forecastSkuRowMap);
    const { sheetName: shipSheetName, skuRowMap: shipSkuRowMap, periodColMap: shipPeriodColMap } =
      buildShipmentSheet(wb, allSkus, sortedPeriods, shipment);
    const { skuRowMap: arrSkuRowMap, periodTotalColMap: arrPeriodTotalColMap } =
      buildArrivalSheet(wb, allSkus, sortedPeriods, arrival, shipment, shipSheetName, shipSkuRowMap, shipPeriodColMap);
    buildPlanningFgSheet(
      wb, weight, allSkus, sortedPeriods, ims, planningFg,
      "IMS vs FRCST", imsFrcstImsRowMap,
      shipSheetName, shipSkuRowMap, shipPeriodColMap,
      "Arrival to Regie", arrSkuRowMap, arrPeriodTotalColMap
    );
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function generateSingleSheetBufferForCountry(country: "Syria" | "Libya" | "KSA", sheet: string): Promise<Buffer> {
  const data = await db.getFullPlanningDataForCountry(country);
  const { skus: allSkus, periods: allPeriods, forecast, ims, arrival, planningFg } = data;
  const actualProduction = await db.getActualProductionDataForCountry(country);
  const sortedPeriods = [...allPeriods].sort((a, b) => a.sortOrder - b.sortOrder);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();

  if (sheet === "ims") {
    buildIntlImsSheet(wb, allSkus, sortedPeriods, ims);
  } else if (sheet === "forecast") {
    buildIntlForecastSheet(wb, "Forecast Production", allSkus, sortedPeriods, forecast);
  } else if (sheet === "forecast-vs-actual") {
    buildIntlForecastVsActualSheet(wb, allSkus, sortedPeriods, forecast, actualProduction);
  } else if (sheet.startsWith("planning-fg-")) {
    const weight = sheet.replace("planning-fg-", "");
    if (allSkus.some(s => s.weight === weight)) {
      buildIntlPlanningFgSheet(wb, weight, allSkus, sortedPeriods, ims, planningFg, arrival);
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ==================== MAIN EXPORT ====================
export async function generateExcelBuffer(): Promise<Buffer> {
  const data = await db.getFullPlanningData();
  const { skus: allSkus, periods: allPeriods, forecast, ims, shipment, arrival, planningFg } = data;
  const sortedPeriods = [...allPeriods].sort((a, b) => a.sortOrder - b.sortOrder);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();

  const sheetNames = ["Navigation", "Dashboard", "Forecast", "IMS vs FRCST", "Shipment (Production)", "Arrival to Regie"];
  const weights = ["50g", "250g", "1kg"];
  for (const w of weights) {
    if (allSkus.some(s => s.weight === w)) sheetNames.push(`Planning FG ${w}`);
  }

  // 1. Navigation
  buildNavigationSheet(wb, sheetNames);

  // 2. Dashboard
  buildDashboardSheet(wb, allSkus, allPeriods, forecast, ims, shipment, sheetNames);

  // 3. Forecast — returns SKU row map
  const { skuRowMap: forecastSkuRowMap } = buildForecastSheet(wb, allSkus, sortedPeriods, forecast);

  // 4. IMS vs Forecast — uses Forecast cross-sheet refs, returns IMS row map
  const { skuForecastRowMap: imsFrcstForecastRowMap, skuImsRowMap: imsFrcstImsRowMap } =
    buildImsVsForecastSheet(wb, allSkus, sortedPeriods, forecast, ims, forecastSkuRowMap);

  // 5. Shipment — returns row/col maps
  const { sheetName: shipSheetName, skuRowMap: shipSkuRowMap, periodColMap: shipPeriodColMap } =
    buildShipmentSheet(wb, allSkus, sortedPeriods, shipment);

  // 6. Arrival to Regie — cross-sheet to Shipment, returns row/col maps
  const { skuRowMap: arrSkuRowMap, periodTotalColMap: arrPeriodTotalColMap } =
    buildArrivalSheet(wb, allSkus, sortedPeriods, arrival, shipment, shipSheetName, shipSkuRowMap, shipPeriodColMap);

  // 7. Planning FG sheets — cross-sheet to IMS vs FRCST, Shipment, Arrival
  for (const w of weights) {
    if (allSkus.some(s => s.weight === w)) {
      buildPlanningFgSheet(
        wb, w, allSkus, sortedPeriods, ims, planningFg,
        "IMS vs FRCST", imsFrcstImsRowMap,
        shipSheetName, shipSkuRowMap, shipPeriodColMap,
        "Arrival to Regie", arrSkuRowMap, arrPeriodTotalColMap
      );
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ============================================================
// COUNTRY-SPECIFIC EXPORT (Syria / Libya)
// ============================================================

function buildIntlImsSheet(
  wb: ExcelJS.Workbook,
  allSkus: Sku[],
  sortedPeriods: Period[],
  ims: { skuId: number; periodId: number; value: string | null }[]
) {
  const ws = wb.addWorksheet("IMS");
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
  const imsMap = new Map<string, number>();
  for (const d of ims) imsMap.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
  const headerRow = ws.addRow(["SKU Name", "Weight", "Packaging", ...sortedPeriods.map(p => p.label), "Total"]);
  applyHeaderStyle(headerRow, 3 + sortedPeriods.length + 1);
  ws.getRow(1).height = 20;
  for (const sku of allSkus) {
    const vals = sortedPeriods.map(p => imsMap.get(`${sku.id}-${p.id}`) ?? 0);
    const total = vals.reduce((s, v) => s + v, 0);
    const row = ws.addRow([sku.name, sku.weight, sku.packagingType ?? "New", ...vals, total]);
    bd(row.getCell(1)); bd(row.getCell(2)); bd(row.getCell(3));
    for (let i = 0; i < vals.length; i++) { const c = row.getCell(4 + i); c.value = vals[i] || null; bd(c); }
    const tc = row.getCell(4 + vals.length); tc.value = total || null; tc.font = { bold: true }; bd(tc);
  }
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 10; ws.getColumn(3).width = 12;
  for (let i = 4; i <= 3 + sortedPeriods.length + 1; i++) ws.getColumn(i).width = 12;
}

function buildIntlForecastSheet(
  wb: ExcelJS.Workbook, sheetName: string, allSkus: Sku[], sortedPeriods: Period[],
  forecast: { skuId: number; periodId: number; value: string | null }[]
) {
  const ws = wb.addWorksheet(sheetName);
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
  const fMap = new Map<string, number>();
  for (const d of forecast) fMap.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
  const headerRow = ws.addRow(["SKU Name", "Weight", "Packaging", ...sortedPeriods.map(p => p.label), "Total"]);
  applyHeaderStyle(headerRow, 3 + sortedPeriods.length + 1);
  ws.getRow(1).height = 20;
  for (const sku of allSkus) {
    const vals = sortedPeriods.map(p => fMap.get(`${sku.id}-${p.id}`) ?? 0);
    const total = vals.reduce((s, v) => s + v, 0);
    const row = ws.addRow([sku.name, sku.weight, sku.packagingType ?? "New", ...vals, total]);
    bd(row.getCell(1)); bd(row.getCell(2)); bd(row.getCell(3));
    for (let i = 0; i < vals.length; i++) { const c = row.getCell(4 + i); c.value = vals[i] || null; bd(c); }
    const tc = row.getCell(4 + vals.length); tc.value = total || null; tc.font = { bold: true }; bd(tc);
  }
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 10; ws.getColumn(3).width = 12;
  for (let i = 4; i <= 3 + sortedPeriods.length + 1; i++) ws.getColumn(i).width = 12;
}

function buildIntlForecastVsActualSheet(
  wb: ExcelJS.Workbook, allSkus: Sku[], sortedPeriods: Period[],
  forecast: { skuId: number; periodId: number; value: string | null }[],
  actualProduction: { skuId: number; periodId: number; value: string | null }[]
) {
  const ws = wb.addWorksheet("Forecast vs Actual");
  ws.views = [{ state: "frozen", xSplit: 3, ySplit: 1 }];
  const fMap = new Map<string, number>();
  const rfMap = new Map<string, number>();
  for (const d of forecast) fMap.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
  // Auto-actual: forecast production doubles as actual for the same month unless
  // a manual Actual entry (> 0) overrides it — matches the on-screen behavior.
  for (const d of forecast) { const v = parseFloat(d.value ?? "0") || 0; if (v > 0) rfMap.set(`${d.skuId}-${d.periodId}`, v); }
  for (const d of actualProduction) { const v = parseFloat(d.value ?? "0") || 0; if (v > 0) rfMap.set(`${d.skuId}-${d.periodId}`, v); }
  const headerRow = ws.addRow(["SKU Name", "Weight", "Packaging", ...sortedPeriods.map(p => p.label), "Total"]);
  applyHeaderStyle(headerRow, 3 + sortedPeriods.length + 1);
  ws.getRow(1).height = 20;
  for (const sku of allSkus) {
    const fVals = sortedPeriods.map(p => fMap.get(`${sku.id}-${p.id}`) ?? 0);
    const fTotal = fVals.reduce((s, v) => s + v, 0);
    const fRow = ws.addRow([sku.name + " — Forecast", sku.weight, sku.packagingType ?? "New", ...fVals, fTotal]);
    bd(fRow.getCell(1)); bd(fRow.getCell(2)); bd(fRow.getCell(3));
    for (let i = 0; i < fVals.length; i++) { const c = fRow.getCell(4 + i); c.value = fVals[i] || null; bd(c); }
    const ftc = fRow.getCell(4 + fVals.length); ftc.value = fTotal || null; ftc.font = { bold: true }; bd(ftc);
    const rfVals = sortedPeriods.map(p => rfMap.get(`${sku.id}-${p.id}`) ?? 0);
    const rfTotal = rfVals.reduce((s, v) => s + v, 0);
    const rfRow = ws.addRow([sku.name + " — Actual", sku.weight, sku.packagingType ?? "New", ...rfVals, rfTotal]);
    rfRow.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9C4" } }; bd(c); });
    for (let i = 0; i < rfVals.length; i++) { const c = rfRow.getCell(4 + i); c.value = rfVals[i] || null; bd(c); }
    const rftc = rfRow.getCell(4 + rfVals.length); rftc.value = rfTotal || null; rftc.font = { bold: true }; bd(rftc);
  }
  ws.getColumn(1).width = 35; ws.getColumn(2).width = 10; ws.getColumn(3).width = 12;
  for (let i = 4; i <= 3 + sortedPeriods.length + 1; i++) ws.getColumn(i).width = 12;
}

function buildIntlPlanningFgSheet(
  wb: ExcelJS.Workbook, weight: string, allSkus: Sku[], sortedPeriods: Period[],
  ims: { skuId: number; periodId: number; value: string | null }[],
  planningFg: { skuId: number; periodId: number; openingStock: string | null; adjustments: string | null; invoiced: string | null; arrivals: string | null }[],
  arrivalData: { skuId: number; periodId: number; week1: string | null; week2: string | null; week3: string | null; week4: string | null }[]
) {
  const ws = wb.addWorksheet(`Planning FG ${weight}`);
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
  const weightSkus = allSkus.filter(s => s.weight === weight);
  if (weightSkus.length === 0) return ws;
  const imsMap = new Map<string, number>();
  for (const d of ims) imsMap.set(`${d.skuId}-${d.periodId}`, parseFloat(d.value ?? "0") || 0);
  const pgMap = new Map<string, { openingStock: number; adjustments: number; invoiced: number; arrivals: number }>();
  for (const d of planningFg) pgMap.set(`${d.skuId}-${d.periodId}`, {
    openingStock: parseFloat(d.openingStock ?? "0") || 0,
    adjustments: parseFloat(d.adjustments ?? "0") || 0,
    invoiced: parseFloat(d.invoiced ?? "0") || 0,
    arrivals: parseFloat(d.arrivals ?? "0") || 0,
  });
  const arrMap = new Map<string, number>();
  for (const d of arrivalData) {
    const total = (parseFloat(d.week1 ?? "0") || 0) + (parseFloat(d.week2 ?? "0") || 0) + (parseFloat(d.week3 ?? "0") || 0) + (parseFloat(d.week4 ?? "0") || 0);
    arrMap.set(`${d.skuId}-${d.periodId}`, total);
  }
  const ROWS = ["Opening Stock", "IMS (Consumption)", "Adjustments", "Arrivals / Orders", "Closing Stock", "Stock Weeks"];
  const headerRow = ws.addRow(["SKU Name", "Packaging", "Row", ...sortedPeriods.map(p => p.label)]);
  applyHeaderStyle(headerRow, 3 + sortedPeriods.length);
  ws.getRow(1).height = 20;
  for (const sku of weightSkus) {
    const closingStocks: number[] = [];
    for (let pi = 0; pi < sortedPeriods.length; pi++) {
      const p = sortedPeriods[pi];
      const pg = pgMap.get(`${sku.id}-${p.id}`) ?? { openingStock: 0, adjustments: 0, invoiced: 0, arrivals: 0 };
      const imsVal = imsMap.get(`${sku.id}-${p.id}`) ?? 0;
      const arrVal = arrMap.get(`${sku.id}-${p.id}`) ?? pg.arrivals;
      const opening = pi === 0 ? pg.openingStock : closingStocks[pi - 1];
      closingStocks.push(opening + pg.adjustments + arrVal - imsVal);
    }
    const openingStocks = sortedPeriods.map((p, pi) => {
      if (pi === 0) return pgMap.get(`${sku.id}-${p.id}`)?.openingStock ?? 0;
      return closingStocks[pi - 1];
    });
    for (let ri = 0; ri < ROWS.length; ri++) {
      const rowLabel = ROWS[ri];
      const vals: (number | null)[] = sortedPeriods.map((p, pi) => {
        const pg = pgMap.get(`${sku.id}-${p.id}`) ?? { openingStock: 0, adjustments: 0, invoiced: 0, arrivals: 0 };
        const imsVal = imsMap.get(`${sku.id}-${p.id}`) ?? 0;
        const arrVal = arrMap.get(`${sku.id}-${p.id}`) ?? pg.arrivals;
        if (rowLabel === "Opening Stock") return openingStocks[pi] || null;
        if (rowLabel === "IMS (Consumption)") return imsVal || null;
        if (rowLabel === "Adjustments") return pg.adjustments || null;
        if (rowLabel === "Arrivals / Orders") return arrVal || null;
        if (rowLabel === "Closing Stock") return closingStocks[pi] || null;
        if (rowLabel === "Stock Weeks") {
          const closing = closingStocks[pi];
          if (closing <= 0) return 0;
          return imsVal > 0 ? Math.round((closing / imsVal) * 4 * 10) / 10 : null;
        }
        return null;
      });
      const row = ws.addRow([ri === 0 ? sku.name : "", ri === 0 ? (sku.packagingType ?? "New") : "", rowLabel, ...vals]);
      bd(row.getCell(1)); bd(row.getCell(2)); bd(row.getCell(3));
      if (rowLabel === "Closing Stock") applySubtotalStyle(row, 3 + sortedPeriods.length);
      if (rowLabel === "Stock Weeks") row.eachCell(c => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F5E9" } }; bd(c); });
      for (let i = 0; i < vals.length; i++) { const c = row.getCell(4 + i); c.value = vals[i]; bd(c); }
    }
    ws.addRow([]);
  }
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 12; ws.getColumn(3).width = 22;
  for (let i = 4; i <= 3 + sortedPeriods.length; i++) ws.getColumn(i).width = 12;
  return ws;
}

export async function generateExcelBufferForCountry(country: "Syria" | "Libya" | "KSA"): Promise<Buffer> {
  const data = await db.getFullPlanningDataForCountry(country);
  const { skus: allSkus, periods: allPeriods, forecast, ims, arrival, planningFg } = data;
  const actualProduction = await db.getActualProductionDataForCountry(country);
  const sortedPeriods = [...allPeriods].sort((a, b) => a.sortOrder - b.sortOrder);
  const weights = ["50g", "250g", "1kg"];
  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();
  buildIntlImsSheet(wb, allSkus, sortedPeriods, ims);
  buildIntlForecastSheet(wb, "Forecast Production", allSkus, sortedPeriods, forecast);
  buildIntlForecastVsActualSheet(wb, allSkus, sortedPeriods, forecast, actualProduction);
  for (const w of weights) {
    if (allSkus.some(s => s.weight === w)) {
      buildIntlPlanningFgSheet(wb, w, allSkus, sortedPeriods, ims, planningFg, arrival);
    }
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ==================== ANALYSIS EXPORT ====================

const HEADER_STYLE_ANALYSIS: Partial<ExcelJS.Style> = {
  font: { bold: true, color: { argb: "FFFFFFFF" }, size: 11 },
  fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D9488" } },
  alignment: { horizontal: "center", vertical: "middle" },
  border: {
    bottom: { style: "thin", color: { argb: "FF0D9488" } },
  },
};

function styleAnalysisHeader(ws: ExcelJS.Worksheet, colCount: number) {
  const row = ws.getRow(1);
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).style = HEADER_STYLE_ANALYSIS as ExcelJS.Style;
  }
  row.height = 22;
}

export async function generateAnalysisExcelBuffer(): Promise<Buffer> {
  const overview = await db.getAnalysisOverview();
  const bySku = await db.getAnalysisBySku();
  const byWeight = await db.getAnalysisByWeight();
  const byCategory = await db.getAnalysisByCategory();
  const byFlavor = await db.getAnalysisByFlavor();
  const production = await db.getAnalysisProduction();
  const stockHealth = await db.getAnalysisStockHealth();
  const runningRate = await db.getRunningRateAnalysis("Lebanon");
  const stockLevels = await db.getStockLevelAnalysis("Lebanon");
  const stockSnapshot = await db.getStockSnapshot();

  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();

  const wsOverview = wb.addWorksheet("Overview");
  wsOverview.columns = [
    { header: "Metric", key: "metric", width: 25 },
    { header: "Value", key: "value", width: 20 },
  ];
  wsOverview.addRow({ metric: "Total SKUs", value: overview.totalSkus });
  wsOverview.addRow({ metric: "Total Forecast", value: overview.totalForecast });
  wsOverview.addRow({ metric: "Total Production", value: overview.totalProduction });
  wsOverview.addRow({ metric: "Total Arrival", value: overview.totalArrival });
  wsOverview.addRow({ metric: "Avg Weeks of Stock", value: overview.avgWeeksOfStock });
  wsOverview.addRow({});
  if (overview.monthlyTrend.length > 0) {
    wsOverview.addRow({ metric: "Monthly Trend", value: "" });
    const trendRowNum = wsOverview.rowCount + 1;
    const trendHeader = wsOverview.getRow(trendRowNum);
    trendHeader.getCell(1).value = "Period";
    trendHeader.getCell(2).value = "Forecast";
    trendHeader.getCell(3).value = "Production";
    trendHeader.getCell(4).value = "Arrival";
    for (let c = 1; c <= 4; c++) {
      trendHeader.getCell(c).style = HEADER_STYLE_ANALYSIS as ExcelJS.Style;
    }
    trendHeader.commit();
    for (const m of overview.monthlyTrend) {
      const r = wsOverview.addRow({});
      r.getCell(1).value = m.period;
      r.getCell(2).value = Math.round(m.forecast);
      r.getCell(3).value = Math.round(m.production);
      r.getCell(4).value = Math.round(m.arrival);
      r.getCell(2).numFmt = "#,##0";
      r.getCell(3).numFmt = "#,##0";
      r.getCell(4).numFmt = "#,##0";
    }
  }
  styleAnalysisHeader(wsOverview, 2);

  const wsSku = wb.addWorksheet("By SKU");
  wsSku.columns = [
    { header: "SKU Name", key: "name", width: 35 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Category", key: "category", width: 12 },
    { header: "Packaging", key: "packagingType", width: 12 },
    { header: "Total Forecast", key: "totalForecast", width: 16 },
    { header: "Total Production", key: "totalProduction", width: 18 },
    { header: "Total IMS", key: "totalIms", width: 14 },
    { header: "Forecast Accuracy %", key: "forecastAccuracy", width: 20 },
    { header: "Avg Weeks of Stock", key: "avgWeeksOfStock", width: 20 },
    { header: "Current Stock (MC)", key: "currentStockMC", width: 20 },
  ];
  for (const s of bySku.sort((a, b) => b.totalForecast - a.totalForecast)) {
    const r = wsSku.addRow({
      name: s.name, weight: s.weight, category: s.category,
      packagingType: (s as any).packagingType ?? "New",
      totalForecast: s.totalForecast, totalProduction: s.totalProduction,
      totalIms: s.totalIms, forecastAccuracy: s.forecastAccuracy,
      avgWeeksOfStock: s.avgWeeksOfStock,
      currentStockMC: (s as any).currentStockMC ?? 0,
    });
    r.getCell(5).numFmt = "#,##0";
    r.getCell(6).numFmt = "#,##0";
    r.getCell(7).numFmt = "#,##0";
    r.getCell(8).numFmt = "0";
    r.getCell(9).numFmt = "0.0";
    r.getCell(10).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsSku, 10);

  const wsWeight = wb.addWorksheet("By Weight");
  wsWeight.columns = [
    { header: "Weight", key: "weight", width: 12 },
    { header: "SKU Count", key: "skuCount", width: 12 },
    { header: "Total Forecast", key: "totalForecast", width: 16 },
    { header: "Total Production", key: "totalProduction", width: 18 },
    { header: "Total IMS", key: "totalIms", width: 14 },
  ];
  for (const w of byWeight) {
    const r = wsWeight.addRow({
      weight: w.weight, skuCount: w.skuCount,
      totalForecast: w.totalForecast, totalProduction: w.totalProduction,
      totalIms: w.totalIms,
    });
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).numFmt = "#,##0";
    r.getCell(5).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsWeight, 5);

  const wsCategory = wb.addWorksheet("By Category");
  wsCategory.columns = [
    { header: "Category", key: "category", width: 15 },
    { header: "SKU Count", key: "skuCount", width: 12 },
    { header: "Total Forecast", key: "totalForecast", width: 16 },
    { header: "Total Production", key: "totalProduction", width: 18 },
    { header: "Total IMS", key: "totalIms", width: 14 },
  ];
  for (const c of byCategory) {
    const r = wsCategory.addRow({
      category: c.category, skuCount: c.skuCount,
      totalForecast: c.totalForecast, totalProduction: c.totalProduction,
      totalIms: c.totalIms,
    });
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).numFmt = "#,##0";
    r.getCell(5).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsCategory, 5);

  const wsFlavor = wb.addWorksheet("By Flavor");
  wsFlavor.columns = [
    { header: "Flavor", key: "flavor", width: 30 },
    { header: "Weights", key: "weights", width: 18 },
    { header: "Total Forecast", key: "totalForecast", width: 16 },
    { header: "Total IMS", key: "totalIms", width: 14 },
    { header: "Total Production", key: "totalProduction", width: 18 },
  ];
  for (const f of byFlavor) {
    const r = wsFlavor.addRow({
      flavor: f.flavor, weights: f.weights.join(", "),
      totalForecast: f.totalForecast, totalIms: f.totalIms,
      totalProduction: f.totalProduction,
    });
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).numFmt = "#,##0";
    r.getCell(5).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsFlavor, 5);

  const wsProd = wb.addWorksheet("Production Monthly");
  wsProd.columns = [
    { header: "Period", key: "period", width: 18 },
    { header: "Shipped", key: "shipped", width: 14 },
    { header: "Arrived", key: "arrived", width: 14 },
    { header: "Gap", key: "gap", width: 14 },
    { header: "Efficiency %", key: "efficiency", width: 14 },
  ];
  for (const m of production.monthly) {
    const r = wsProd.addRow({
      period: m.period, shipped: m.shipped, arrived: m.arrived,
      gap: m.gap, efficiency: m.efficiency,
    });
    r.getCell(2).numFmt = "#,##0";
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).numFmt = "#,##0";
    r.getCell(5).numFmt = "0";
  }
  styleAnalysisHeader(wsProd, 5);

  const wsProdSku = wb.addWorksheet("Production by SKU");
  wsProdSku.columns = [
    { header: "SKU Name", key: "name", width: 35 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Category", key: "category", width: 12 },
    { header: "Packaging", key: "packagingType", width: 12 },
    { header: "Total Shipped", key: "totalShipped", width: 16 },
    { header: "Total Arrived", key: "totalArrived", width: 16 },
    { header: "Gap", key: "gap", width: 14 },
    { header: "Efficiency %", key: "efficiency", width: 14 },
  ];
  for (const s of production.skuEfficiency) {
    const r = wsProdSku.addRow({
      name: s.name, weight: s.weight, category: s.category,
      packagingType: (s as any).packagingType ?? "New",
      totalShipped: s.totalShipped, totalArrived: s.totalArrived,
      gap: s.gap, efficiency: s.efficiency,
    });
    r.getCell(5).numFmt = "#,##0";
    r.getCell(6).numFmt = "#,##0";
    r.getCell(7).numFmt = "#,##0";
    r.getCell(8).numFmt = "0";
  }
  styleAnalysisHeader(wsProdSku, 8);

  const wsHealth = wb.addWorksheet("Stock Health Zones");
  wsHealth.columns = [
    { header: "Zone", key: "zone", width: 18 },
    { header: "Count", key: "count", width: 12 },
    { header: "Percentage %", key: "percentage", width: 14 },
  ];
  for (const z of stockHealth.zones) {
    wsHealth.addRow({ zone: z.zone, count: z.count, percentage: z.percentage });
  }
  styleAnalysisHeader(wsHealth, 3);

  const wsHealthSku = wb.addWorksheet("Stock Health by SKU");
  wsHealthSku.columns = [
    { header: "SKU Name", key: "name", width: 35 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Category", key: "category", width: 12 },
    { header: "Packaging", key: "packagingType", width: 12 },
    { header: "Avg Weeks of Stock", key: "avgWeeksOfStock", width: 20 },
    { header: "Health Score %", key: "healthScore", width: 16 },
    { header: "Out of Stock", key: "oos", width: 14 },
    { header: "Critical", key: "critical", width: 12 },
    { header: "Healthy", key: "healthy", width: 12 },
    { header: "Overstock", key: "overstock", width: 12 },
    { header: "Negative", key: "negative", width: 12 },
  ];
  for (const s of stockHealth.skuHealth) {
    const r = wsHealthSku.addRow({
      name: s.name, weight: s.weight, category: s.category,
      packagingType: (s as any).packagingType ?? "New",
      avgWeeksOfStock: s.avgWeeksOfStock, healthScore: s.healthScore,
      oos: s.zoneBreakdown["Out of Stock"] || 0,
      critical: s.zoneBreakdown["Critical"] || 0,
      healthy: s.zoneBreakdown["Healthy"] || 0,
      overstock: s.zoneBreakdown["Overstock"] || 0,
      negative: s.zoneBreakdown["Negative"] || 0,
    });
    r.getCell(5).numFmt = "0.0";
    r.getCell(6).numFmt = "0";
  }
  styleAnalysisHeader(wsHealthSku, 11);

  // ---- Running Rate ----
  if (runningRate) {
    const wsRate = wb.addWorksheet("Running Rate");
    const rateColCount = 11 + runningRate.periodLabels.length;
    wsRate.columns = [
      { header: "SKU Name", key: "name", width: 35 },
      { header: "Weight", key: "weight", width: 10 },
      { header: "Category", key: "category", width: 12 },
      { header: "Packaging", key: "packagingType", width: 12 },
      { header: "Avg 3M", key: "avg3m", width: 12 },
      { header: "Avg 6M", key: "avg6m", width: 12 },
      { header: "Avg All", key: "avgAll", width: 12 },
      { header: "Trend %", key: "trend", width: 10 },
      { header: "Direction", key: "trendDirection", width: 12 },
      { header: "Peak Month", key: "peakMonth", width: 14 },
      { header: "Peak Value", key: "peakValue", width: 12 },
      ...runningRate.periodLabels.map(l => ({ header: l, key: l, width: 12 })),
    ];
    for (const sr of runningRate.skuRates) {
      const r = wsRate.addRow({
        name: sr.name, weight: sr.weight, category: sr.category,
        packagingType: (sr as any).packagingType ?? "New",
        avg3m: sr.avg3m, avg6m: sr.avg6m, avgAll: sr.avgAll,
        trend: sr.trend, trendDirection: sr.trendDirection,
        peakMonth: sr.peakMonth, peakValue: sr.peakValue,
      });
      for (let mi = 0; mi < sr.monthlyValues.length; mi++) {
        r.getCell(12 + mi).value = sr.monthlyValues[mi];
        r.getCell(12 + mi).numFmt = "#,##0";
      }
      r.getCell(5).numFmt = "#,##0";
      r.getCell(6).numFmt = "#,##0";
      r.getCell(7).numFmt = "#,##0";
      r.getCell(11).numFmt = "#,##0";
    }
    styleAnalysisHeader(wsRate, rateColCount);

    const wsRateSummary = wb.addWorksheet("Running Rate Summary");
    wsRateSummary.columns = [
      { header: "Metric", key: "metric", width: 25 },
      { header: "Value", key: "value", width: 20 },
    ];
    wsRateSummary.addRow({ metric: "Total SKUs", value: runningRate.totalSkus });
    wsRateSummary.addRow({ metric: "Total IMS", value: runningRate.totalIms });
    wsRateSummary.addRow({ metric: "Total Avg 3M", value: runningRate.totalAvg3m });
    wsRateSummary.addRow({ metric: "Overall Trend %", value: runningRate.overallTrend });
    wsRateSummary.addRow({});
    wsRateSummary.addRow({ metric: "By Flavor", value: "" });
    const flvHdrRow = wsRateSummary.rowCount + 1;
    const flvHdr = wsRateSummary.getRow(flvHdrRow);
    flvHdr.getCell(1).value = "Flavor";
    flvHdr.getCell(2).value = "Total IMS";
    flvHdr.getCell(3).value = "Avg 3M";
    flvHdr.getCell(4).value = "SKU Count";
    flvHdr.getCell(5).value = "Trend %";
    for (let c = 1; c <= 5; c++) flvHdr.getCell(c).style = HEADER_STYLE_ANALYSIS as ExcelJS.Style;
    flvHdr.commit();
    for (const f of runningRate.flavorSummary) {
      const r = wsRateSummary.addRow({});
      r.getCell(1).value = f.flavor;
      r.getCell(2).value = f.totalIms;
      r.getCell(3).value = f.avg3m;
      r.getCell(4).value = f.skuCount;
      r.getCell(5).value = f.trend;
      r.getCell(2).numFmt = "#,##0";
      r.getCell(3).numFmt = "#,##0";
    }
    wsRateSummary.addRow({});
    wsRateSummary.addRow({ metric: "By Weight", value: "" });
    const wtHdrRow = wsRateSummary.rowCount + 1;
    const wtHdr = wsRateSummary.getRow(wtHdrRow);
    wtHdr.getCell(1).value = "Weight";
    wtHdr.getCell(2).value = "Total IMS";
    wtHdr.getCell(3).value = "Avg 3M";
    wtHdr.getCell(4).value = "SKU Count";
    wtHdr.getCell(5).value = "Trend %";
    for (let c = 1; c <= 5; c++) wtHdr.getCell(c).style = HEADER_STYLE_ANALYSIS as ExcelJS.Style;
    wtHdr.commit();
    for (const w of runningRate.weightSummary) {
      const r = wsRateSummary.addRow({});
      r.getCell(1).value = w.weight;
      r.getCell(2).value = w.totalIms;
      r.getCell(3).value = w.avg3m;
      r.getCell(4).value = w.skuCount;
      r.getCell(5).value = w.trend;
      r.getCell(2).numFmt = "#,##0";
      r.getCell(3).numFmt = "#,##0";
    }
    styleAnalysisHeader(wsRateSummary, 2);
  }

  // ---- Stock Levels ----
  if (stockLevels) {
    const wsLevels = wb.addWorksheet("Stock Levels");
    const slColCount = 10 + stockLevels.periodLabels.length;
    wsLevels.columns = [
      { header: "SKU Name", key: "name", width: 35 },
      { header: "Weight", key: "weight", width: 10 },
      { header: "Category", key: "category", width: 12 },
      { header: "Packaging", key: "packagingType", width: 12 },
      { header: "Current Stock", key: "currentClosingStock", width: 16 },
      { header: "Current Weeks", key: "currentWeeks", width: 14 },
      { header: "Current Zone", key: "currentZone", width: 14 },
      { header: "Avg Weeks", key: "avgWeeks", width: 12 },
      { header: "Health Score %", key: "healthScore", width: 16 },
      { header: "Coverage Months", key: "coverageMonths", width: 16 },
      ...stockLevels.periodLabels.map(l => ({ header: l + " (weeks)", key: "p_" + l, width: 14 })),
    ];
    for (const ss of stockLevels.skuStocks) {
      const r = wsLevels.addRow({
        name: ss.name, weight: ss.weight, category: ss.category,
        packagingType: (ss as any).packagingType ?? "New",
        currentClosingStock: ss.currentClosingStock,
        currentWeeks: ss.currentWeeks, currentZone: ss.currentZone,
        avgWeeks: ss.avgWeeks, healthScore: ss.healthScore,
        coverageMonths: ss.coverageMonths,
      });
      for (let pi = 0; pi < ss.weeksOfStock.length; pi++) {
        r.getCell(11 + pi).value = ss.weeksOfStock[pi];
        r.getCell(11 + pi).numFmt = "0.0";
      }
      r.getCell(5).numFmt = "#,##0";
      r.getCell(6).numFmt = "0.0";
      r.getCell(8).numFmt = "0.0";
      r.getCell(10).numFmt = "0.0";
    }
    styleAnalysisHeader(wsLevels, slColCount);

    const wsLvlSummary = wb.addWorksheet("Stock Levels Summary");
    wsLvlSummary.columns = [
      { header: "Metric", key: "metric", width: 25 },
      { header: "Value", key: "value", width: 20 },
    ];
    wsLvlSummary.addRow({ metric: "Total SKUs", value: stockLevels.totalSkus });
    wsLvlSummary.addRow({ metric: "Total Closing Stock", value: stockLevels.totalClosingStock });
    wsLvlSummary.addRow({ metric: "Avg Weeks (All SKUs)", value: stockLevels.avgWeeksAll });
    wsLvlSummary.addRow({ metric: "Avg Health Score %", value: stockLevels.avgHealthScore });
    wsLvlSummary.addRow({});
    wsLvlSummary.addRow({ metric: "Zone Distribution", value: "" });
    const zdHdrRow = wsLvlSummary.rowCount + 1;
    const zdHdr = wsLvlSummary.getRow(zdHdrRow);
    zdHdr.getCell(1).value = "Zone";
    zdHdr.getCell(2).value = "Count";
    zdHdr.getCell(3).value = "Percentage %";
    for (let c = 1; c <= 3; c++) zdHdr.getCell(c).style = HEADER_STYLE_ANALYSIS as ExcelJS.Style;
    zdHdr.commit();
    for (const z of stockLevels.zoneDistribution) {
      const r = wsLvlSummary.addRow({});
      r.getCell(1).value = z.zone;
      r.getCell(2).value = z.count;
      r.getCell(3).value = z.percentage;
    }
    wsLvlSummary.addRow({});
    wsLvlSummary.addRow({ metric: "By Weight", value: "" });
    const wStHdrRow = wsLvlSummary.rowCount + 1;
    const wStHdr = wsLvlSummary.getRow(wStHdrRow);
    wStHdr.getCell(1).value = "Weight";
    wStHdr.getCell(2).value = "Total Stock";
    wStHdr.getCell(3).value = "Avg Weeks";
    wStHdr.getCell(4).value = "SKU Count";
    for (let c = 1; c <= 4; c++) wStHdr.getCell(c).style = HEADER_STYLE_ANALYSIS as ExcelJS.Style;
    wStHdr.commit();
    for (const ws of stockLevels.weightStockSummary) {
      const r = wsLvlSummary.addRow({});
      r.getCell(1).value = ws.weight;
      r.getCell(2).value = ws.totalStock;
      r.getCell(3).value = ws.avgWeeks;
      r.getCell(4).value = ws.skuCount;
      r.getCell(2).numFmt = "#,##0";
      r.getCell(3).numFmt = "0.0";
    }
    styleAnalysisHeader(wsLvlSummary, 2);
  }

  // ---- Stock Snapshot ----
  if (stockSnapshot) {
    const wsSnap = wb.addWorksheet("Stock Snapshot");
    const snapPeriodLabels = stockSnapshot.periodLabels || [];
    const snapColCount = 12 + snapPeriodLabels.length;
    wsSnap.columns = [
      { header: "SKU Name", key: "name", width: 35 },
      { header: "Weight", key: "weight", width: 10 },
      { header: "Category", key: "category", width: 12 },
      { header: "Packaging", key: "packagingType", width: 12 },
      { header: "Current Weeks", key: "currentWeeks", width: 14 },
      { header: "Current Zone", key: "currentZone", width: 14 },
      { header: "Trend", key: "trend", width: 12 },
      { header: "Health Score %", key: "healthScore", width: 16 },
      { header: "Critical Periods", key: "criticalCount", width: 16 },
      { header: "Overstock Periods", key: "overstockCount", width: 18 },
      { header: "Future Forecast", key: "futureForecast", width: 16 },
      { header: "Future Shipment", key: "futureShipment", width: 16 },
      ...snapPeriodLabels.map(l => ({ header: l, key: "sp_" + l, width: 12 })),
    ];
    const heatmap = stockSnapshot.heatmap || [];
    const critMap = new Map((stockSnapshot.criticalSkus || []).map((s: any) => [s.id, s]));
    const overMap = new Map((stockSnapshot.overstockedSkus || []).map((s: any) => [s.id, s]));
    const allSnap = [...(stockSnapshot.criticalSkus || []), ...(stockSnapshot.overstockedSkus || [])];
    const seenIds = new Set<number>();
    const allSnapItems: any[] = [];
    for (const h of heatmap) {
      const id = h.skuId;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const crit = critMap.get(id) as any;
      const over = overMap.get(id) as any;
      const src = crit || over || h;
      allSnapItems.push({ ...h, ...src, periods: h.periods });
    }
    for (const item of allSnapItems) {
      const r = wsSnap.addRow({
        name: item.skuName || item.name,
        weight: item.weight,
        category: item.category,
        packagingType: item.packagingType ?? "New",
        currentWeeks: item.currentWeeks ?? 0,
        currentZone: item.currentZone ?? "",
        trend: item.trend ?? "",
        healthScore: item.healthScore ?? 0,
        criticalCount: item.criticalCount ?? 0,
        overstockCount: item.overstockCount ?? 0,
        futureForecast: Math.round(item.futureForecast ?? 0),
        futureShipment: Math.round(item.futureShipment ?? 0),
      });
      const periods = item.periods || [];
      for (let pi = 0; pi < periods.length; pi++) {
        r.getCell(13 + pi).value = periods[pi].weeks;
        r.getCell(13 + pi).numFmt = "0.0";
      }
      r.getCell(5).numFmt = "0.0";
      r.getCell(11).numFmt = "#,##0";
      r.getCell(12).numFmt = "#,##0";
    }
    styleAnalysisHeader(wsSnap, snapColCount);

    const wsSnapSummary = wb.addWorksheet("Snapshot Summary");
    wsSnapSummary.columns = [
      { header: "Metric", key: "metric", width: 25 },
      { header: "Value", key: "value", width: 20 },
    ];
    const summary = stockSnapshot.summary || {};
    wsSnapSummary.addRow({ metric: "Total SKUs", value: summary.total ?? 0 });
    wsSnapSummary.addRow({ metric: "Critical / Negative / OOS", value: summary.critical ?? 0 });
    wsSnapSummary.addRow({ metric: "Healthy (at risk)", value: summary.warning ?? 0 });
    wsSnapSummary.addRow({ metric: "Healthy (clean)", value: summary.healthy ?? 0 });
    wsSnapSummary.addRow({ metric: "Overstock", value: summary.overstock ?? 0 });
    wsSnapSummary.addRow({ metric: "Out of Stock", value: summary.outOfStock ?? 0 });
    wsSnapSummary.addRow({});
    const actionSummary = stockSnapshot.actionSummary || {};
    wsSnapSummary.addRow({ metric: "Actions Needed", value: "" });
    wsSnapSummary.addRow({ metric: "Need Forecast Reduction", value: actionSummary.needForecastReduction ?? 0 });
    wsSnapSummary.addRow({ metric: "Need Production Increase", value: actionSummary.needProductionIncrease ?? 0 });
    wsSnapSummary.addRow({ metric: "Need Both", value: actionSummary.needBoth ?? 0 });
    styleAnalysisHeader(wsSnapSummary, 2);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function generateIntlAnalysisExcelBuffer(country: "Syria" | "Libya" | "KSA"): Promise<Buffer> {
  const data = await db.getIntlAnalysis(country);
  if (!data) throw new Error(`No analysis data available for ${country}`);

  const runningRate = await db.getRunningRateAnalysis(country);
  const stockLevels = await db.getStockLevelAnalysis(country);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SSOF Planning System";
  wb.created = new Date();

  const wsOverview = wb.addWorksheet("Overview");
  wsOverview.columns = [
    { header: "Metric", key: "metric", width: 30 },
    { header: "Value", key: "value", width: 20 },
  ];
  wsOverview.addRow({ metric: "Country", value: country });
  wsOverview.addRow({ metric: "Total SKUs", value: data.totalSkus });
  wsOverview.addRow({ metric: "Total Production", value: data.totalProduction });
  wsOverview.addRow({ metric: "Total Cleared", value: data.totalCleared });
  wsOverview.addRow({ metric: "Total Pending", value: data.totalPending });
  wsOverview.addRow({ metric: "Clearance Rate %", value: data.clearanceRate });
  wsOverview.addRow({ metric: "Batches With Delay", value: data.batchesWithDelay });
  wsOverview.addRow({ metric: "Overall Forecast Accuracy %", value: data.overallForecastAccuracy ?? "N/A" });
  wsOverview.addRow({ metric: "IMS Growth Rate %", value: data.imsGrowthRate ?? "N/A" });
  styleAnalysisHeader(wsOverview, 2);

  const wsProd = wb.addWorksheet("Production by SKU");
  wsProd.columns = [
    { header: "SKU Name", key: "name", width: 35 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Category", key: "category", width: 12 },
    { header: "Packaging", key: "packagingType", width: 12 },
    { header: "Total Production", key: "totalProduction", width: 18 },
    { header: "Total IMS", key: "totalIms", width: 14 },
    { header: "Current Stock (MC)", key: "currentStockMC", width: 20 },
  ];
  for (const s of (data.skuProductionBreakdown as any[]).sort((a: any, b: any) => b.totalProduction - a.totalProduction)) {
    const r = wsProd.addRow({
      name: s.name, weight: s.weight, category: s.category,
      packagingType: s.packagingType,
      totalProduction: s.totalProduction, totalIms: s.totalIms,
      currentStockMC: s.currentStockMC ?? 0,
    });
    r.getCell(5).numFmt = "#,##0";
    r.getCell(6).numFmt = "#,##0";
    r.getCell(7).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsProd, 7);

  const wsMonthly = wb.addWorksheet("Monthly Trends");
  const periodLabels = data.periodLabels as string[];
  wsMonthly.columns = [
    { header: "Period", key: "period", width: 18 },
    { header: "Production", key: "production", width: 16 },
    { header: "IMS", key: "ims", width: 14 },
    { header: "Forecast", key: "forecast", width: 16 },
    { header: "Actual Production", key: "actual_prod", width: 18 },
  ];
  for (let i = 0; i < periodLabels.length; i++) {
    const r = wsMonthly.addRow({
      period: periodLabels[i],
      production: (data.monthlyProductionSeries as number[])[i] ?? 0,
      ims: (data.monthlyImsSeries as number[])[i] ?? 0,
      forecast: (data.monthlyForecastSeries as number[])[i] ?? 0,
      actual_prod: (data.monthlyActualProductionSeries as number[])[i] ?? 0,
    });
    for (let c = 2; c <= 5; c++) r.getCell(c).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsMonthly, 5);

  const wsAccuracy = wb.addWorksheet("Forecast Accuracy");
  wsAccuracy.columns = [
    { header: "Period", key: "label", width: 18 },
    { header: "Forecast", key: "forecast", width: 16 },
    { header: "Actual", key: "actual", width: 16 },
    { header: "Accuracy %", key: "accuracy", width: 14 },
    { header: "Variance %", key: "variance", width: 14 },
  ];
  for (const p of data.forecastAccuracyByPeriod as any[]) {
    const r = wsAccuracy.addRow({
      label: p.label, forecast: p.forecast, actual: p.actual,
      accuracy: p.accuracy, variance: p.variance,
    });
    r.getCell(2).numFmt = "#,##0";
    r.getCell(3).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsAccuracy, 5);

  const wsClearance = wb.addWorksheet("Clearance Batches");
  wsClearance.columns = [
    { header: "SKU Name", key: "skuName", width: 35 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Period", key: "periodLabel", width: 18 },
    { header: "Total Qty", key: "totalQty", width: 14 },
    { header: "Cleared Qty", key: "clearedQty", width: 14 },
    { header: "Pending Qty", key: "pendingQty", width: 14 },
    { header: "Status", key: "status", width: 18 },
    { header: "Arrival Date", key: "arrivalDate", width: 14 },
    { header: "Days at Port", key: "daysAtPort", width: 14 },
  ];
  for (const b of data.clearanceBatches as any[]) {
    const r = wsClearance.addRow({
      skuName: b.skuName, weight: b.weight, periodLabel: b.periodLabel,
      totalQty: b.totalQty, clearedQty: b.clearedQty, pendingQty: b.pendingQty,
      status: b.status, arrivalDate: b.arrivalDate ?? "",
      daysAtPort: b.daysAtPort ?? "",
    });
    r.getCell(4).numFmt = "#,##0";
    r.getCell(5).numFmt = "#,##0";
    r.getCell(6).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsClearance, 9);

  const wsFlavour = wb.addWorksheet("By Flavour");
  wsFlavour.columns = [
    { header: "Flavour", key: "name", width: 30 },
    { header: "SKU Count", key: "skuCount", width: 12 },
    { header: "Total Production", key: "totalProduction", width: 18 },
    { header: "Total IMS", key: "totalIms", width: 14 },
    { header: "Total Forecast", key: "totalForecast", width: 16 },
    { header: "% Production", key: "pctProduction", width: 14 },
    { header: "% IMS", key: "pctIms", width: 10 },
  ];
  for (const f of data.flavourBreakdown as any[]) {
    const r = wsFlavour.addRow({
      name: f.name, skuCount: f.skuCount,
      totalProduction: f.totalProduction, totalIms: f.totalIms,
      totalForecast: f.totalForecast,
      pctProduction: f.pctProduction, pctIms: f.pctIms,
    });
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).numFmt = "#,##0";
    r.getCell(5).numFmt = "#,##0";
    r.getCell(6).numFmt = "0.0";
    r.getCell(7).numFmt = "0.0";
  }
  styleAnalysisHeader(wsFlavour, 7);

  const wsWeight = wb.addWorksheet("By Weight");
  wsWeight.columns = [
    { header: "Weight", key: "weight", width: 12 },
    { header: "SKU Count", key: "skuCount", width: 12 },
    { header: "Total Production", key: "totalProduction", width: 18 },
    { header: "Total IMS", key: "totalIms", width: 14 },
  ];
  for (const w of data.weightBreakdown as any[]) {
    const r = wsWeight.addRow({
      weight: w.weight, skuCount: w.skuCount,
      totalProduction: w.totalProduction, totalIms: w.totalIms,
    });
    r.getCell(3).numFmt = "#,##0";
    r.getCell(4).numFmt = "#,##0";
  }
  styleAnalysisHeader(wsWeight, 4);

  if (runningRate) {
    const wsRate = wb.addWorksheet("Running Rate");
    const rateColCount = 11 + runningRate.periodLabels.length;
    wsRate.columns = [
      { header: "SKU Name", key: "name", width: 35 },
      { header: "Weight", key: "weight", width: 10 },
      { header: "Category", key: "category", width: 12 },
      { header: "Packaging", key: "packagingType", width: 12 },
      { header: "Avg 3M", key: "avg3m", width: 12 },
      { header: "Avg 6M", key: "avg6m", width: 12 },
      { header: "Avg All", key: "avgAll", width: 12 },
      { header: "Trend %", key: "trend", width: 10 },
      { header: "Direction", key: "trendDirection", width: 12 },
      { header: "Peak Month", key: "peakMonth", width: 14 },
      { header: "Peak Value", key: "peakValue", width: 12 },
      ...runningRate.periodLabels.map(l => ({ header: l, key: l, width: 12 })),
    ];
    for (const sr of runningRate.skuRates) {
      const r = wsRate.addRow({
        name: sr.name, weight: sr.weight, category: sr.category,
        packagingType: (sr as any).packagingType ?? "New",
        avg3m: sr.avg3m, avg6m: sr.avg6m, avgAll: sr.avgAll,
        trend: sr.trend, trendDirection: sr.trendDirection,
        peakMonth: sr.peakMonth, peakValue: sr.peakValue,
      });
      for (let mi = 0; mi < sr.monthlyValues.length; mi++) {
        r.getCell(12 + mi).value = sr.monthlyValues[mi];
        r.getCell(12 + mi).numFmt = "#,##0";
      }
      r.getCell(5).numFmt = "#,##0";
      r.getCell(6).numFmt = "#,##0";
      r.getCell(7).numFmt = "#,##0";
      r.getCell(11).numFmt = "#,##0";
    }
    styleAnalysisHeader(wsRate, rateColCount);
  }

  if (stockLevels) {
    const wsLevels = wb.addWorksheet("Stock Levels");
    const slColCount = 10 + stockLevels.periodLabels.length;
    wsLevels.columns = [
      { header: "SKU Name", key: "name", width: 35 },
      { header: "Weight", key: "weight", width: 10 },
      { header: "Category", key: "category", width: 12 },
      { header: "Packaging", key: "packagingType", width: 12 },
      { header: "Current Stock", key: "currentClosingStock", width: 16 },
      { header: "Current Weeks", key: "currentWeeks", width: 14 },
      { header: "Current Zone", key: "currentZone", width: 14 },
      { header: "Avg Weeks", key: "avgWeeks", width: 12 },
      { header: "Health Score %", key: "healthScore", width: 16 },
      { header: "Coverage Months", key: "coverageMonths", width: 16 },
      ...stockLevels.periodLabels.map(l => ({ header: l + " (weeks)", key: "p_" + l, width: 14 })),
    ];
    for (const ss of stockLevels.skuStocks) {
      const r = wsLevels.addRow({
        name: ss.name, weight: ss.weight, category: ss.category,
        packagingType: (ss as any).packagingType ?? "New",
        currentClosingStock: ss.currentClosingStock,
        currentWeeks: ss.currentWeeks, currentZone: ss.currentZone,
        avgWeeks: ss.avgWeeks, healthScore: ss.healthScore,
        coverageMonths: ss.coverageMonths,
      });
      for (let pi = 0; pi < ss.weeksOfStock.length; pi++) {
        r.getCell(11 + pi).value = ss.weeksOfStock[pi];
        r.getCell(11 + pi).numFmt = "0.0";
      }
      r.getCell(5).numFmt = "#,##0";
      r.getCell(6).numFmt = "0.0";
      r.getCell(8).numFmt = "0.0";
      r.getCell(10).numFmt = "0.0";
    }
    styleAnalysisHeader(wsLevels, slColCount);
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
