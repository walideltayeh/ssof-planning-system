import ExcelJS from "exceljs";
import * as db from "./db";

interface ImportResult {
  updated: number;
  skipped: string[];
  sheet: string;
}

function normalizeStr(s: any): string {
  return String(s ?? "").trim();
}

function cellNum(cell: ExcelJS.Cell): number {
  const v = cell.value;
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) {
    const r = (v as any).result;
    return typeof r === "number" ? r : parseFloat(String(r)) || 0;
  }
  return parseFloat(String(v)) || 0;
}

function findWorksheet(wb: ExcelJS.Workbook, preferredNames: string[]): ExcelJS.Worksheet {
  for (const name of preferredNames) {
    const ws = wb.worksheets.find(w => w.name.toLowerCase() === name.toLowerCase());
    if (ws) return ws;
  }
  const last = wb.worksheets[wb.worksheets.length - 1];
  if (last) return last;
  throw new Error("No worksheet found in the uploaded file");
}

async function resolveSkuMap(country: string): Promise<Map<string, { id: number; weight: string }>> {
  const skuList = country === "Lebanon"
    ? await db.getAllSkus()
    : await db.getSkusForCountry(country as any);
  const map = new Map<string, { id: number; weight: string }>();
  for (const s of skuList) {
    map.set(s.name.trim().toLowerCase(), { id: s.id, weight: s.weight });
  }
  return map;
}

async function resolvePeriodMap(country: string): Promise<Map<string, number>> {
  const periodList = country === "Lebanon"
    ? await db.getAllPeriods()
    : await db.getPeriodsForCountry(country as any);
  const map = new Map<string, number>();
  for (const p of periodList) {
    map.set(p.label.trim().toLowerCase(), p.id);
  }
  return map;
}

function findHeaderRow(ws: ExcelJS.Worksheet): { row: number; periodCols: Map<string, number> } | null {
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const periodCols = new Map<string, number>();
    for (let c = 1; c <= row.cellCount + 5; c++) {
      const val = normalizeStr(row.getCell(c).value).toLowerCase();
      if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}$/.test(val)) {
        periodCols.set(val, c);
      }
    }
    if (periodCols.size > 0) return { row: r, periodCols };
  }
  return null;
}

export async function importForecastSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = findWorksheet(wb, ["Forecast", "Forecast Production"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);
  const header = findHeaderRow(ws);
  if (!header) throw new Error("Could not find period headers in the file. Expected month columns like 'Jan 25', 'Feb 25', etc.");

  const skuNameCol = findSkuNameCol(ws, header.row);
  const records: { skuId: number; periodId: number; value: string }[] = [];
  const skipped: string[] = [];

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = normalizeStr(row.getCell(skuNameCol).value);
    if (!rawName || rawName.toLowerCase().startsWith("subtotal") || rawName.toLowerCase().startsWith("grand total") || rawName === "←") continue;
    const sku = skuMap.get(rawName.toLowerCase());
    if (!sku) { skipped.push(rawName); continue; }

    for (const [periodLabel, col] of header.periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      const val = cellNum(row.getCell(col));
      records.push({ skuId: sku.id, periodId, value: val.toString() });
    }
  }

  if (records.length > 0) {
    await db.bulkUpsertForecast(records);
  }

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: "Forecast",
    details: `Imported ${records.length} cells from Excel. ${skipped.length} SKUs skipped.`,
  });

  return { updated: records.length, skipped: [...new Set(skipped)], sheet: "Forecast" };
}

export async function importImsSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = findWorksheet(wb, ["IMS vs FRCST", "IMS"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);
  const header = findHeaderRow(ws);
  if (!header) throw new Error("Could not find period headers. Expected month columns like 'Jan 25'.");

  const skuNameCol = findSkuNameCol(ws, header.row);
  const records: { skuId: number; periodId: number; value: string; isActual: boolean }[] = [];
  const skipped: string[] = [];

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = normalizeStr(row.getCell(skuNameCol).value);
    if (!rawName || rawName.toLowerCase().startsWith("subtotal") || rawName.toLowerCase().startsWith("grand total") || rawName === "←") continue;

    const rowLabel = findRowLabel(ws, row, header.row);
    if (rowLabel === "Forecast" || rowLabel === "Variance") continue;

    const sku = skuMap.get(rawName.toLowerCase());
    if (!sku) { skipped.push(rawName); continue; }

    for (const [periodLabel, col] of header.periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      const val = cellNum(row.getCell(col));
      records.push({ skuId: sku.id, periodId, value: val.toString(), isActual: true });
    }
  }

  if (records.length > 0) {
    await db.bulkUpsertIms(records);
  }

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: "IMS",
    details: `Imported ${records.length} cells from Excel. ${skipped.length} SKUs skipped.`,
  });

  return { updated: records.length, skipped: [...new Set(skipped)], sheet: "IMS" };
}

export async function importShipmentSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = findWorksheet(wb, ["Shipment (Production)", "Shipment"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);

  const periodCols = findShipmentPeriodCols(ws);
  if (periodCols.size === 0) throw new Error("Could not find period columns with W1/W2/W3/W4 sub-headers");

  const skuNameCol = findSkuNameColShipment(ws);
  const records: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
  const skipped: string[] = [];

  const dataStartRow = 3;
  for (let r = dataStartRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = normalizeStr(row.getCell(skuNameCol).value);
    if (!rawName || rawName.toLowerCase().startsWith("subtotal") || rawName.toLowerCase().startsWith("grand total") || rawName === "←") continue;
    const sku = skuMap.get(rawName.toLowerCase());
    if (!sku) { skipped.push(rawName); continue; }

    for (const [periodLabel, startCol] of periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      records.push({
        skuId: sku.id,
        periodId,
        week1: cellNum(row.getCell(startCol)).toString(),
        week2: cellNum(row.getCell(startCol + 1)).toString(),
        week3: cellNum(row.getCell(startCol + 2)).toString(),
        week4: cellNum(row.getCell(startCol + 3)).toString(),
      });
    }
  }

  if (records.length > 0) {
    await db.bulkUpsertShipment(records);
  }

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: "Shipment",
    details: `Imported ${records.length} period-records from Excel. ${skipped.length} SKUs skipped.`,
  });

  return { updated: records.length, skipped: [...new Set(skipped)], sheet: "Shipment" };
}

export async function importArrivalSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = findWorksheet(wb, ["Arrival to Regie", "Arrival"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);

  const periodCols = findShipmentPeriodCols(ws);
  if (periodCols.size === 0) throw new Error("Could not find period columns with W1/W2/W3/W4 sub-headers");

  const skuNameCol = findSkuNameColShipment(ws);
  const records: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
  const skipped: string[] = [];

  const dataStartRow = 3;
  for (let r = dataStartRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = normalizeStr(row.getCell(skuNameCol).value);
    if (!rawName || rawName.toLowerCase().startsWith("subtotal") || rawName.toLowerCase().startsWith("grand total") || rawName === "←") continue;
    const sku = skuMap.get(rawName.toLowerCase());
    if (!sku) { skipped.push(rawName); continue; }

    for (const [periodLabel, startCol] of periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      records.push({
        skuId: sku.id,
        periodId,
        week1: cellNum(row.getCell(startCol)).toString(),
        week2: cellNum(row.getCell(startCol + 1)).toString(),
        week3: cellNum(row.getCell(startCol + 2)).toString(),
        week4: cellNum(row.getCell(startCol + 3)).toString(),
      });
    }
  }

  if (records.length > 0) {
    await db.bulkUpsertArrival(records);
  }

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: "Arrival",
    details: `Imported ${records.length} period-records from Excel. ${skipped.length} SKUs skipped.`,
  });

  return { updated: records.length, skipped: [...new Set(skipped)], sheet: "Arrival" };
}

export async function importPlanningFgSheet(buffer: Buffer, weight: string, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = findWorksheet(wb, [`Planning FG ${weight}`]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);
  const header = findHeaderRow(ws);
  if (!header) throw new Error("Could not find period headers. Expected month columns like 'Jan 25'.");

  const isLebanon = country === "Lebanon";
  const skuNameCol = isLebanon ? 2 : 1;
  const rowLabelCol = isLebanon ? 3 : 2;

  const records: Map<string, { skuId: number; periodId: number; openingStock?: string; adjustments?: string }> = new Map();
  const skipped: string[] = [];
  let currentSkuName = "";

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nameCell = normalizeStr(row.getCell(skuNameCol).value);
    if (nameCell) currentSkuName = nameCell;
    if (!currentSkuName) continue;

    const rowLabel = normalizeStr(row.getCell(rowLabelCol).value).toLowerCase();
    if (!rowLabel) continue;

    const isOpeningStock = rowLabel.includes("opening stock");
    const isAdjustments = rowLabel.includes("adjustment");
    if (!isOpeningStock && !isAdjustments) continue;

    const sku = skuMap.get(currentSkuName.toLowerCase());
    if (!sku) { skipped.push(currentSkuName); continue; }
    if (sku.weight !== weight) continue;

    for (const [periodLabel, col] of header.periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      const val = cellNum(row.getCell(col));
      const key = `${sku.id}-${periodId}`;
      const existing = records.get(key) ?? { skuId: sku.id, periodId };
      if (isOpeningStock) existing.openingStock = val.toString();
      if (isAdjustments) existing.adjustments = val.toString();
      records.set(key, existing);
    }
  }

  const recordsList = Array.from(records.values());
  if (recordsList.length > 0) {
    await db.bulkUpsertPlanningFg(recordsList as any);
  }

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: `Planning FG ${weight}`,
    details: `Imported ${recordsList.length} records from Excel. ${skipped.length} SKUs skipped.`,
  });

  return { updated: recordsList.length, skipped: [...new Set(skipped)], sheet: `Planning FG ${weight}` };
}

function findSkuNameCol(ws: ExcelJS.Worksheet, headerRow: number): number {
  const row = ws.getRow(headerRow);
  for (let c = 1; c <= row.cellCount + 5; c++) {
    const val = normalizeStr(row.getCell(c).value).toLowerCase();
    if (val === "sku name" || val === "sku") return c;
  }
  for (let c = 1; c <= row.cellCount + 5; c++) {
    const val = normalizeStr(row.getCell(c).value).toLowerCase();
    if (val.includes("name")) return c;
  }
  return 3;
}

function findRowLabel(ws: ExcelJS.Worksheet, row: ExcelJS.Row, headerRowNum: number): string | null {
  const headerRow = ws.getRow(headerRowNum);
  for (let c = 1; c <= headerRow.cellCount + 5; c++) {
    const hVal = normalizeStr(headerRow.getCell(c).value).toLowerCase();
    if (hVal === "row") {
      return normalizeStr(row.getCell(c).value);
    }
  }
  return null;
}

function findShipmentPeriodCols(ws: ExcelJS.Worksheet): Map<string, number> {
  const periodCols = new Map<string, number>();
  const row1 = ws.getRow(1);
  const row2 = ws.getRow(2);

  for (let c = 1; c <= (row1.cellCount || 0) + 20; c++) {
    const val = normalizeStr(row1.getCell(c).value).toLowerCase();
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}$/.test(val)) {
      const w1 = normalizeStr(row2.getCell(c).value).toLowerCase();
      if (w1 === "w1") {
        periodCols.set(val, c);
      }
    }
  }

  if (periodCols.size === 0) {
    let lastPeriodLabel = "";
    for (let c = 4; c <= (row1.cellCount || 0) + 50; c++) {
      const hVal = normalizeStr(row1.getCell(c).value).toLowerCase();
      if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}$/.test(hVal)) {
        lastPeriodLabel = hVal;
      }
      const subVal = normalizeStr(row2.getCell(c).value).toLowerCase();
      if (subVal === "w1" && lastPeriodLabel) {
        periodCols.set(lastPeriodLabel, c);
      }
    }
  }

  return periodCols;
}

function findSkuNameColShipment(ws: ExcelJS.Worksheet): number {
  const row = ws.getRow(1);
  for (let c = 1; c <= (row.cellCount || 0) + 5; c++) {
    const val = normalizeStr(row.getCell(c).value).toLowerCase();
    if (val === "sku name" || val === "sku") return c;
    if (val.includes("name")) return c;
  }
  return 3;
}

export async function handleImportSheet(
  buffer: Buffer,
  sheet: string,
  country: string,
  username: string
): Promise<ImportResult> {
  switch (sheet) {
    case "forecast":
      return importForecastSheet(buffer, country, username);
    case "ims":
      return importImsSheet(buffer, country, username);
    case "shipment":
      return importShipmentSheet(buffer, country, username);
    case "arrival":
      return importArrivalSheet(buffer, country, username);
    case "planning-fg-50g":
      return importPlanningFgSheet(buffer, "50g", country, username);
    case "planning-fg-250g":
      return importPlanningFgSheet(buffer, "250g", country, username);
    case "planning-fg-1kg":
      return importPlanningFgSheet(buffer, "1kg", country, username);
    default:
      throw new Error(`Unknown sheet type: ${sheet}`);
  }
}
