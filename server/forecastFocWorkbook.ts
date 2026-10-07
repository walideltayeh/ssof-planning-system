import ExcelJS from "exceljs";
import { mcPrecision } from "../shared/performance/foc";
import type { FocReceiptDataset } from "../shared/performance/focReceipts";

export const FORECAST_FOC_FORMAT = "SSOF paired forecast v1";
export type ForecastUnit = "MC" | "KG" | "Tons";
export type ForecastSheetData = Omit<FocReceiptDataset, "skus"> & {
  forecast: { skuId: number; periodId: number; value: string | number | null }[];
  skus: (FocReceiptDataset["skus"][number] & { packagingType?: string | null })[];
};
export type ForecastFocImportCell = {
  skuId: number; periodId: number; value: string | null; received: boolean;
  receivedDate?: string | null; receiptDecision?: string; receiptReviewKey?: string | null;
};
const factor = (unit: ForecastUnit) => unit === "KG" ? 6 : unit === "Tons" ? 0.006 : 1;
const text = (cell: ExcelJS.Cell) => {
  const v = cell.value;
  if (v && typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  return String(v ?? "").trim();
};
const identity = (name: string, weight: string, packaging: string) =>
  [name, weight, packaging].map(s => s.trim().toLowerCase()).join("|");

/** The display rows and receipt metadata all refer to the existing SKU/month FOC cells. */
export function buildForecastFocSheet(wb: ExcelJS.Workbook, ds: ForecastSheetData, includeFoc: boolean, unit: ForecastUnit) {
  const ws = wb.addWorksheet("Forecast Production");
  const ss = ds.skus.filter(s => s.isActive !== false && (!s.country || s.country === ds.country));
  const ps = ds.periods.filter(p => !p.country || p.country === ds.country);
  const forecasts = new Map(ds.forecast.map(c => [`${c.skuId}-${c.periodId}`, Number(c.value) || 0]));
  const foc = new Map((ds.foc ?? []).filter(c => !c.country || c.country === ds.country).map(c => [`${c.skuId}-${c.periodId}`, c]));
  const convert = (q: number) => Math.round(q * factor(unit) * 1e8) / 1e8;
  const basis = includeFoc ? "including planned FOC" : "ordered only; FOC excluded";
  ws.addRow(["Country", ds.country, "Unit", unit, "Include FOC", includeFoc ? "Yes" : "No", "Format", FORECAST_FOC_FORMAT]);
  const header = ws.addRow(["SKU Name", "Weight", "Packaging", "Row", ...ps.map(p => p.label), `Total (${unit})`]);
  header.eachCell(c => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF166534" } }; });
  ws.addRow([`Combined basis: ${basis}. Received FOC changes stock only when included and duplicate-checked. Missing FOC is not set, not zero. Duplicate decisions/key are read-only metadata; new approvals require admin review in the app.`]);
  const write = (sku: typeof ss[number], label: string, values: ExcelJS.CellValue[], total?: ExcelJS.CellValue) => {
    const row = ws.addRow([sku.name, sku.weight, sku.packagingType ?? "New", label, ...values, total ?? null]);
    row.eachCell((c, col) => {
      if (label.startsWith("FOC")) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FDF4" } };
      if (col >= 5 && typeof c.value === "number") c.numFmt = unit === "Tons" ? "0.00000" : "0.00";
    });
    return row;
  };
  for (const s of ss) {
    const cells = ps.map(p => foc.get(`${s.id}-${p.id}`));
    const ordered = ps.map(p => forecasts.get(`${s.id}-${p.id}`) ?? 0);
    const free = cells.map(c => c?.value == null ? null : Number(c.value));
    const entered = free.reduce<number>((sum, q) => sum + (q ?? 0), 0);
    const missing = free.some(q => q === null);
    write(s, "Ordered", ordered.map(convert), convert(ordered.reduce((sum, q) => sum + q, 0)));
    write(s, "FOC", free.map(q => q === null ? null : convert(q)),
      missing ? `Not set; entered subtotal ${convert(entered)} ${unit}` : convert(entered));
    write(s, "FOC Received", cells.map(c => c?.received ? "Yes" : "No"));
    write(s, "FOC Received date", cells.map(c => c?.receivedDate ?? null));
    write(s, "FOC duplicate decision", cells.map(c => c?.receiptDecision ?? "pending"));
    write(s, "FOC review key", cells.map(c => c?.receiptReviewKey ?? null));
    write(s, `Combined (${basis})`, ordered.map((q, i) => includeFoc && free[i] === null ? "Not set" : convert(q + (includeFoc ? free[i] ?? 0 : 0))),
      includeFoc && missing ? "Not set" : convert(ordered.reduce((sum, q) => sum + q, 0) + (includeFoc ? entered : 0)));
  }
  const totalSkus = ss.filter(s => !s.isExcludedFromTotal);
  for (const label of ["Ordered", "FOC", `Combined (${basis})`]) {
    const vals = ps.map(p => {
      const paid = totalSkus.reduce((sum, s) => sum + (forecasts.get(`${s.id}-${p.id}`) ?? 0), 0);
      const cells = totalSkus.map(s => foc.get(`${s.id}-${p.id}`));
      const complete = cells.every(c => c?.value != null);
      const free = cells.reduce((sum, c) => sum + Number(c?.value ?? 0), 0);
      if (label === "Ordered") return convert(paid);
      if ((label === "FOC" || includeFoc) && !complete) return `Not set; entered subtotal ${convert(label === "FOC" ? free : paid + free)} ${unit}`;
      return convert(label === "FOC" ? free : paid + (includeFoc ? free : 0));
    });
    ws.addRow(["Grand total", "", "", label, ...vals]);
  }
  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 3 }];
  ws.pageSetup.printTitlesRow = "1:3";
  ws.headerFooter.oddHeader = `&L${ds.country}: ${basis}&R${unit} · &P of &N`;
  ws.headerFooter.evenHeader = ws.headerFooter.oddHeader;
  ws.getColumn(1).width = 26; ws.getColumn(2).width = 10; ws.getColumn(3).width = 12; ws.getColumn(4).width = 36;
  for (let i = 5; i <= 5 + ps.length; i++) ws.getColumn(i).width = 17;
  return ws;
}

export function isForecastFocSheet(ws: ExcelJS.Worksheet, headerRow: number) {
  const typeCol = ws.getRow(headerRow).values instanceof Array
    ? (ws.getRow(headerRow).values as ExcelJS.CellValue[]).findIndex(v => String(v).trim().toLowerCase() === "row") : -1;
  const tagged = Array.from({ length: Math.min(ws.rowCount, 10) }, (_, i) => ws.getRow(i + 1))
    .some(r => (r.values as ExcelJS.CellValue[]).some(v => v === FORECAST_FOC_FORMAT));
  let foc = false;
  if (typeCol > 0) ws.eachRow(r => { if (text(r.getCell(typeCol)) === "FOC") foc = true; });
  return { paired: tagged || foc, typeCol };
}

/** Strict packaging-aware matching prevents the repeated rows from triggering
 * legacy occurrence-based SKU fallback, or accidentally overwriting paid forecast. */
export function parseForecastFocSheet(ws: ExcelJS.Worksheet, country: string, ds: Pick<ForecastSheetData, "skus" | "periods">,
  headerRow: number, typeCol: number, periodCols: Map<number, number>) {
  if (typeCol <= 0) throw new Error("Paired forecast sheet is missing its Row column");
  let unit: ForecastUnit = "MC";
  for (let r = 1; r < headerRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= row.cellCount; c++) {
      const key = text(row.getCell(c));
      if (key === "Country" && text(row.getCell(c + 1)) !== country) throw new Error("Workbook country does not match the import country");
      if (key === "Unit") {
        const value = text(row.getCell(c + 1));
        if (!["MC", "KG", "Tons"].includes(value)) throw new Error("Workbook unit must be MC, KG or Tons");
        unit = value as ForecastUnit;
      }
    }
  }
  const skuMap = new Map<string, typeof ds.skus[number]>();
  for (const s of ds.skus) {
    if (s.country && s.country !== country) continue;
    const k = identity(s.name ?? "", s.weight ?? "", s.packagingType ?? "New");
    if (skuMap.has(k)) throw new Error(`Ambiguous SKU: ${s.name} ${s.weight} ${s.packagingType}`);
    skuMap.set(k, s);
  }
  const grouped = new Map<number, Map<string, ExcelJS.Row>>();
  const labels = new Set(["Ordered", "FOC", "FOC Received", "FOC Received date", "FOC duplicate decision", "FOC review key"]);
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), name = text(row.getCell(1)), label = text(row.getCell(typeCol));
    if (!name || name === "Grand total" || name.startsWith("Subtotal") || name.startsWith("Combined basis:") || label.startsWith("Combined (")) continue;
    if (!labels.has(label)) throw new Error(`Unknown forecast row '${label}' for ${name}`);
    const weight = text(row.getCell(2)), packaging = text(row.getCell(3));
    const sku = skuMap.get(identity(name, weight, packaging));
    if (!sku || sku.isActive === false) throw new Error(`No active exact ${country} SKU: ${name} ${weight} ${packaging}`);
    const rows = grouped.get(sku.id) ?? new Map<string, ExcelJS.Row>();
    if (rows.has(label)) throw new Error(`Duplicate ${label} row for ${name} ${weight} ${packaging}`);
    rows.set(label, row); grouped.set(sku.id, rows);
  }
  const quantity = (cell: ExcelJS.Cell, nullable: boolean) => {
    const raw = text(cell);
    if (!raw || (nullable && raw.toLowerCase() === "not set")) return nullable ? null : "0.00";
    const q = Number(raw);
    if (!Number.isFinite(q) || q < 0 || q / factor(unit) > 9999999999.99) throw new Error(`Invalid quantity in ${cell.address}: '${raw}'`);
    return mcPrecision(q / factor(unit)).toFixed(2);
  };
  const forecast: { skuId: number; periodId: number; value: string }[] = [], foc: ForecastFocImportCell[] = [];
  for (const [skuId, rows] of grouped) {
    if (!rows.has("Ordered") || !rows.has("FOC") || !rows.has("FOC Received"))
      throw new Error(`SKU ${skuId} needs paired Ordered, FOC and FOC Received rows`);
    for (const [periodId, col] of periodCols) {
      forecast.push({ skuId, periodId, value: quantity(rows.get("Ordered")!.getCell(col), false)! });
      const raw = text(rows.get("FOC Received")!.getCell(col)).toLowerCase();
      if (!["", "yes", "no", "true", "false"].includes(raw)) throw new Error(`Received must be Yes or No for SKU ${skuId}, month ${periodId}`);
      const received = raw === "yes" || raw === "true", value = quantity(rows.get("FOC")!.getCell(col), true);
      if (received && value === null) throw new Error(`Received FOC needs a quantity for SKU ${skuId}, month ${periodId}`);
      const dateCell = rows.get("FOC Received date")?.getCell(col);
      const dateValue = dateCell?.value;
      const date = Object.prototype.toString.call(dateValue) === "[object Date]"
        ? (dateValue as Date).toISOString().slice(0, 10) : dateCell ? text(dateCell) : undefined;
      foc.push({ skuId, periodId, value, received, receivedDate: date === undefined ? undefined : date || null,
        receiptDecision: rows.has("FOC duplicate decision") ? text(rows.get("FOC duplicate decision")!.getCell(col)) : undefined,
        receiptReviewKey: rows.has("FOC review key") ? text(rows.get("FOC review key")!.getCell(col)) || null : undefined });
    }
  }
  return { forecast, foc, unit };
}
