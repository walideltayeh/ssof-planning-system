import ExcelJS from "exceljs";
import * as db from "./db";
import { loadXlsxBuffer } from "./excelLoad";

interface ImportResult {
  updated: number;
  skipped: string[];
  sheet: string;
  detectedPeriods?: string[];
  matchedPeriods?: string[];
  unmatchedPeriods?: string[];
}

function normalizeStr(s: any): string {
  return String(s ?? "").trim();
}

function cellNum(cell: ExcelJS.Cell): number {
  const val = cellNumOrNull(cell);
  return val ?? 0;
}

function cellNumOrNull(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (r === null || r === undefined) return null;
    if (typeof r === "number") return r;
    const parsed = parseFloat(String(r));
    return isNaN(parsed) ? null : parsed;
  }
  const parsed = parseFloat(String(v));
  return isNaN(parsed) ? null : parsed;
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

interface SkuEntry { id: number; weight: string }

type SkuMap = {
  byNameWeightPkg: Map<string, SkuEntry>;
  byNameWeightAll: Map<string, SkuEntry[]>;
  byName: Map<string, SkuEntry>;
  _nwOccurrence: Map<string, number>;
};

async function resolveSkuMap(country: string): Promise<SkuMap> {
  const skuList = country === "Lebanon"
    ? await db.getAllSkus()
    : await db.getSkusForCountry(country as any);
  const byNameWeightPkg = new Map<string, SkuEntry>();
  const byNameWeightAll = new Map<string, SkuEntry[]>();
  const byName = new Map<string, SkuEntry>();
  for (const s of skuList) {
    const key = s.name.trim().toLowerCase();
    const nwKey = `${key}||${s.weight.trim().toLowerCase()}`;
    const entry = { id: s.id, weight: s.weight };
    const existing = byNameWeightAll.get(nwKey) ?? [];
    existing.push(entry);
    byNameWeightAll.set(nwKey, existing);
    byName.set(key, entry);
    const pkg = ((s as any).packagingType ?? "New").toString().trim().toLowerCase();
    byNameWeightPkg.set(`${nwKey}||${pkg}`, entry);
  }
  return { byNameWeightPkg, byNameWeightAll, byName, _nwOccurrence: new Map() };
}

function lookupSku(skuMap: SkuMap, name: string, weight?: string, packaging?: string): SkuEntry | undefined {
  const normName = name.trim().toLowerCase();
  if (weight && packaging) {
    const exact = skuMap.byNameWeightPkg.get(`${normName}||${weight.trim().toLowerCase()}||${packaging.trim().toLowerCase()}`);
    if (exact) return exact;
  }
  if (weight) {
    const nwKey = `${normName}||${weight.trim().toLowerCase()}`;
    const all = skuMap.byNameWeightAll.get(nwKey);
    if (all && all.length === 1) return all[0];
    if (all && all.length > 1) {
      const idx = skuMap._nwOccurrence.get(nwKey) ?? 0;
      skuMap._nwOccurrence.set(nwKey, idx + 1);
      return all[idx % all.length];
    }
  }
  return skuMap.byName.get(normName);
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

function dedup<T extends { skuId: number; periodId: number }>(records: T[]): T[] {
  const map = new Map<string, T>();
  for (const r of records) {
    map.set(`${r.skuId}-${r.periodId}`, r);
  }
  return Array.from(map.values());
}

const MAX_COL = 500;

function safeCellCount(row: ExcelJS.Row): number {
  return Math.min(row.cellCount || 0, MAX_COL);
}

function findHeaderRow(ws: ExcelJS.Worksheet): { row: number; periodCols: Map<string, number>; weightCol: number | null; packagingCol: number | null } | null {
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    const row = ws.getRow(r);
    const periodCols = new Map<string, number>();
    let weightCol: number | null = null;
    let packagingCol: number | null = null;
    const maxCol = Math.max(safeCellCount(row) + 50, ws.columnCount || 0, 100);
    for (let c = 1; c <= maxCol; c++) {
      const val = normalizeStr(row.getCell(c).value).toLowerCase();
      if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}$/.test(val)) {
        periodCols.set(val, c);
      }
      if (val === "weight") weightCol = c;
      if (val === "packaging") packagingCol = c;
    }
    if (periodCols.size > 0) return { row: r, periodCols, weightCol, packagingCol };
  }
  return null;
}

export async function importForecastSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await loadXlsxBuffer(wb, buffer);
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
    const weight = header.weightCol ? normalizeStr(row.getCell(header.weightCol).value) : undefined;
    const packaging = header.packagingCol ? normalizeStr(row.getCell(header.packagingCol).value) : undefined;
    const sku = lookupSku(skuMap, rawName, weight, packaging || undefined);
    if (!sku) { skipped.push(weight ? `${rawName} (${weight})` : rawName); continue; }

    for (const [periodLabel, col] of header.periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      const val = cellNumOrNull(row.getCell(col));
      records.push({ skuId: sku.id, periodId, value: (val ?? 0).toString() });
    }
  }

  const dedupedRecords = dedup(records);
  if (dedupedRecords.length > 0) {
    await db.bulkUpsertForecast(dedupedRecords);
  }

  // For Syria & Libya, auto-sync forecast data into Production (Shipment) table
  if (country !== "Lebanon" && dedupedRecords.length > 0) {
    const shipmentRecords = dedupedRecords.map(r => ({
      skuId: r.skuId,
      periodId: r.periodId,
      week1: r.value,
      week2: "0",
      week3: "0",
      week4: "0",
    }));
    await db.bulkUpsertShipment(shipmentRecords);
    console.log(`[Forecast Import] ${country}: Auto-synced ${shipmentRecords.length} records to Production (Shipment) table`);
  }

  const detectedPeriods = [...header.periodCols.keys()];
  const matchedPeriods = detectedPeriods.filter(p => periodMap.has(p));
  const unmatchedPeriods = detectedPeriods.filter(p => !periodMap.has(p));
  console.log(`[Forecast Import] ${country}: Detected ${detectedPeriods.length} periods: ${detectedPeriods.join(", ")}. Matched: ${matchedPeriods.length}. Unmatched: ${unmatchedPeriods.join(", ") || "none"}`);

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: "Forecast",
    details: `Imported ${dedupedRecords.length} cells from Excel (${matchedPeriods.length} periods). ${skipped.length} SKUs skipped.${country !== "Lebanon" ? " Auto-synced to Production." : ""}${unmatchedPeriods.length > 0 ? ` Unmatched periods: ${unmatchedPeriods.join(", ")}` : ""}`,
  });

  return { updated: dedupedRecords.length, skipped: [...new Set(skipped)], sheet: "Forecast", detectedPeriods, matchedPeriods, unmatchedPeriods };
}

export async function importImsSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await loadXlsxBuffer(wb, buffer);
  const ws = findWorksheet(wb, ["IMS vs FRCST", "IMS"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);
  const header = findHeaderRow(ws);
  if (!header) throw new Error("Could not find period headers. Expected month columns like 'Jan 25'.");

  const skuNameCol = findSkuNameCol(ws, header.row);
  const records: { skuId: number; periodId: number; value: string; isActual: boolean }[] = [];
  const skipped: string[] = [];
  let currentSkuName = "";
  let currentWeight = "";
  let currentPackaging = "";

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = normalizeStr(row.getCell(skuNameCol).value);
    if (rawName && !rawName.toLowerCase().startsWith("subtotal") && !rawName.toLowerCase().startsWith("grand total") && rawName !== "←") {
      currentSkuName = rawName;
      if (header.weightCol) currentWeight = normalizeStr(row.getCell(header.weightCol).value);
      if (header.packagingCol) currentPackaging = normalizeStr(row.getCell(header.packagingCol).value);
    }
    if (!currentSkuName) continue;

    const rowLabel = findRowLabel(ws, row, header.row);
    if (rowLabel === "Forecast" || rowLabel === "Variance") continue;
    if (rowLabel !== null && rowLabel !== "IMS") continue;

    const sku = lookupSku(skuMap, currentSkuName, currentWeight || undefined, currentPackaging || undefined);
    if (!sku) { skipped.push(currentSkuName); continue; }

    for (const [periodLabel, col] of header.periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      const val = cellNumOrNull(row.getCell(col));
      records.push({ skuId: sku.id, periodId, value: (val ?? 0).toString(), isActual: true });
    }
  }

  if (records.length > 0) {
    await db.bulkUpsertIms(dedup(records));
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
  await loadXlsxBuffer(wb, buffer);
  const ws = findWorksheet(wb, ["Shipment (Production)", "Shipment"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);

  const periodCols = findShipmentPeriodCols(ws);
  if (periodCols.size === 0) throw new Error("Could not find period columns with W1/W2/W3/W4 sub-headers");

  const skuNameCol = findSkuNameColShipment(ws);
  const weightCol = findWeightCol(ws);
  const records: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
  const skipped: string[] = [];

  const dataStartRow = 3;
  for (let r = dataStartRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = normalizeStr(row.getCell(skuNameCol).value);
    if (!rawName || rawName.toLowerCase().startsWith("subtotal") || rawName.toLowerCase().startsWith("grand total") || rawName === "←") continue;
    const weight = weightCol ? normalizeStr(row.getCell(weightCol).value) : undefined;
    const sku = lookupSku(skuMap, rawName, weight);
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
    await db.bulkUpsertShipment(dedup(records));
  }

  const detectedPeriods = [...periodCols.keys()];
  const matchedPeriods = detectedPeriods.filter(p => periodMap.has(p));
  const unmatchedPeriods = detectedPeriods.filter(p => !periodMap.has(p));
  console.log(`[Shipment Import] ${country}: Detected ${detectedPeriods.length} periods: ${detectedPeriods.join(", ")}. Matched: ${matchedPeriods.length}. Unmatched: ${unmatchedPeriods.join(", ") || "none"}`);

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: "Shipment",
    details: `Imported ${records.length} period-records from Excel (${matchedPeriods.length} periods). ${skipped.length} SKUs skipped.${unmatchedPeriods.length > 0 ? ` Unmatched periods: ${unmatchedPeriods.join(", ")}` : ""}`,
  });

  return { updated: records.length, skipped: [...new Set(skipped)], sheet: "Shipment", detectedPeriods, matchedPeriods, unmatchedPeriods };
}

export async function importArrivalSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await loadXlsxBuffer(wb, buffer);
  const ws = findWorksheet(wb, ["Arrival to Regie", "Arrival"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);

  const periodCols = findShipmentPeriodCols(ws);
  if (periodCols.size === 0) throw new Error("Could not find period columns with W1/W2/W3/W4 sub-headers");

  const skuNameCol = findSkuNameColShipment(ws);
  const weightCol = findWeightCol(ws);
  const records: { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string }[] = [];
  const skipped: string[] = [];

  const dataStartRow = 3;
  for (let r = dataStartRow; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const rawName = normalizeStr(row.getCell(skuNameCol).value);
    if (!rawName || rawName.toLowerCase().startsWith("subtotal") || rawName.toLowerCase().startsWith("grand total") || rawName === "←") continue;
    const weight = weightCol ? normalizeStr(row.getCell(weightCol).value) : undefined;
    const sku = lookupSku(skuMap, rawName, weight);
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
    await db.bulkUpsertArrival(dedup(records));
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
  await loadXlsxBuffer(wb, buffer);
  const ws = findWorksheet(wb, [`Planning FG ${weight}`]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);
  const header = findHeaderRow(ws);
  if (!header) throw new Error("Could not find period headers. Expected month columns like 'Jan 25'.");

  const isLebanon = country === "Lebanon";
  let packagingCol: number | null = null;
  let rowLabelCol: number;
  let skuNameCol: number;
  if (isLebanon) {
    skuNameCol = 2;
    rowLabelCol = 3;
  } else {
    skuNameCol = 1;
    const hdrRow = ws.getRow(header.row);
    for (let c = 1; c <= safeCellCount(hdrRow) + 5; c++) {
      const v = normalizeStr(hdrRow.getCell(c).value).toLowerCase();
      if (v === "packaging") { packagingCol = c; break; }
    }
    rowLabelCol = packagingCol ? 3 : 2;
  }

  const records: Map<string, { skuId: number; periodId: number; openingStock?: string; adjustments?: string }> = new Map();
  const skipped: string[] = [];
  let currentSkuName = "";
  let currentPackaging = "";

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nameCell = normalizeStr(row.getCell(skuNameCol).value);
    if (nameCell) {
      currentSkuName = nameCell;
      if (packagingCol) currentPackaging = normalizeStr(row.getCell(packagingCol).value);
    }
    if (!currentSkuName) continue;

    const rowLabel = normalizeStr(row.getCell(rowLabelCol).value).toLowerCase();
    if (!rowLabel) continue;

    const isOpeningStock = rowLabel.includes("opening stock");
    const isAdjustments = rowLabel.includes("adjustment");
    if (!isOpeningStock && !isAdjustments) continue;

    const sku = lookupSku(skuMap, currentSkuName, weight, currentPackaging || undefined);
    if (!sku) { skipped.push(currentSkuName); continue; }
    if (sku.weight !== weight) continue;

    for (const [periodLabel, col] of header.periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      const val = cellNumOrNull(row.getCell(col));
      if (val === null) continue;
      const key = `${sku.id}-${periodId}`;
      const existing = records.get(key) ?? { skuId: sku.id, periodId };
      if (isOpeningStock) existing.openingStock = val.toString();
      if (isAdjustments) existing.adjustments = val.toString();
      records.set(key, existing);
    }
  }

  const recordsList = Array.from(records.values());
  if (recordsList.length > 0) {
    await db.bulkUpsertPlanningFgPartial(recordsList);
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

export async function importRevisedForecastSheet(buffer: Buffer, country: string, username: string): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await loadXlsxBuffer(wb, buffer);
  const ws = findWorksheet(wb, ["Forecast vs Actual", "Forecast vs Forecast", "Revised Forecast"]);

  const skuMap = await resolveSkuMap(country);
  const periodMap = await resolvePeriodMap(country);
  const header = findHeaderRow(ws);
  if (!header) throw new Error("Could not find period headers. Expected month columns like 'Jan 25'.");

  const records: { skuId: number; periodId: number; value: string }[] = [];
  const skipped: string[] = [];

  for (let r = header.row + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const nameCell = normalizeStr(row.getCell(1).value);
    if (!nameCell) continue;
    if (!nameCell.toLowerCase().includes("revised")) continue;

    const skuName = nameCell.replace(/\s*—\s*Revised$/i, "").trim();
    const weight = header.weightCol ? normalizeStr(row.getCell(header.weightCol).value) : undefined;
    const packaging = header.packagingCol ? normalizeStr(row.getCell(header.packagingCol).value) : undefined;
    const sku = lookupSku(skuMap, skuName, weight, packaging || undefined);
    if (!sku) { skipped.push(skuName); continue; }

    for (const [periodLabel, col] of header.periodCols) {
      const periodId = periodMap.get(periodLabel);
      if (!periodId) continue;
      const val = cellNumOrNull(row.getCell(col));
      records.push({ skuId: sku.id, periodId, value: (val ?? 0).toString() });
    }
  }

  if (records.length > 0) {
    await db.bulkUpsertRevisedForecast(dedup(records));
  }

  await db.logAudit({
    country: country as any,
    username,
    action: "import",
    sheet: "Forecast vs Actual",
    details: `Imported ${records.length} revised forecast records from Excel. ${skipped.length} SKUs skipped.`,
  });

  return { updated: records.length, skipped: [...new Set(skipped)], sheet: "Forecast vs Actual" };
}

function findSkuNameCol(ws: ExcelJS.Worksheet, headerRow: number): number {
  const row = ws.getRow(headerRow);
  for (let c = 1; c <= safeCellCount(row) + 5; c++) {
    const val = normalizeStr(row.getCell(c).value).toLowerCase();
    if (val === "sku name" || val === "sku") return c;
  }
  for (let c = 1; c <= safeCellCount(row) + 5; c++) {
    const val = normalizeStr(row.getCell(c).value).toLowerCase();
    if (val.includes("name")) return c;
  }
  return 3;
}

function findRowLabel(ws: ExcelJS.Worksheet, row: ExcelJS.Row, headerRowNum: number): string | null {
  const headerRow = ws.getRow(headerRowNum);
  for (let c = 1; c <= safeCellCount(headerRow) + 5; c++) {
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
  const maxCol = Math.max(safeCellCount(row1) + 50, safeCellCount(row2) + 50, ws.columnCount || 0, 100);

  for (let c = 1; c <= maxCol; c++) {
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
    for (let c = 1; c <= maxCol; c++) {
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

function findWeightCol(ws: ExcelJS.Worksheet, maxRow: number = 2): number | null {
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= safeCellCount(row) + 5; c++) {
      if (normalizeStr(row.getCell(c).value).toLowerCase() === "weight") return c;
    }
  }
  return null;
}

function findSkuNameColShipment(ws: ExcelJS.Worksheet): number {
  const row = ws.getRow(1);
  for (let c = 1; c <= safeCellCount(row) + 5; c++) {
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
    case "forecast-vs-actual":
      return importRevisedForecastSheet(buffer, country, username);
    default:
      throw new Error(`Unknown sheet type: ${sheet}`);
  }
}
