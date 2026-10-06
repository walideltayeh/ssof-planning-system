import ExcelJS from "exceljs";
import { buildBatches, isoDate, num, type PerformanceDataset } from "./analysis/countryPerformance.helpers";

type ArrivalDataset = Pick<PerformanceDataset, "country" | "skus" | "periods" | "forecast" | "shipment" | "actualProduction" | "clearanceEvents">;

/** International Arrival is a batch/clearance view, not Lebanon's weekly grid. */
export function buildInternationalArrivalSheets(wb: ExcelJS.Workbook, data: ArrivalDataset) {
  const batches = buildBatches({ ...data, ims: [], arrival: [], planningFg: [], now: new Date() }, data.skus);
  const ws = wb.addWorksheet("Arrival");
  ws.columns = [
    { header: "Country", key: "country", width: 12 },
    { header: "SKU", key: "sku", width: 38 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Packaging", key: "packaging", width: 12 },
    { header: "Production Period", key: "period", width: 20 },
    { header: "Planned Production (MC)", key: "planned", width: 24 },
    { header: "Actual Production (MC)", key: "actual", width: 24 },
    { header: "Batch Quantity (MC)", key: "quantity", width: 22 },
    { header: "Expected Arrival", key: "expected", width: 18 },
    { header: "Status", key: "status", width: 24 },
    { header: "Cleared Quantity (MC)", key: "cleared", width: 22 },
    { header: "Pending Quantity (MC)", key: "pending", width: 22 },
    { header: "Last Cleared Date", key: "clearedDate", width: 18 },
    { header: "Invoice Reference", key: "invoice", width: 22 },
    { header: "Container Reference", key: "container", width: 22 },
    { header: "Notes", key: "notes", width: 40 },
  ];
  for (const b of batches) {
    const row = ws.addRow({
      country: data.country, sku: b.sku.name, weight: b.sku.weight, packaging: b.sku.packagingType ?? "New",
      period: b.period.label, planned: b.plannedMc, actual: b.actualMc, quantity: b.producedMc,
      expected: isoDate(b.expectedArrival) ?? "",
      status: b.producedMc <= 0 && b.eventCount > 0 ? "No production — events" : b.actualMc <= 0 ? "Awaiting Actual" : b.status,
      cleared: b.clearedMc, pending: b.pendingMc, clearedDate: isoDate(b.lastClearedDate) ?? "",
      invoice: b.invoiceRef ?? "", container: b.containerRef ?? "", notes: b.note ?? "",
    });
    for (const col of [6, 7, 8, 11, 12]) row.getCell(col).numFmt = "#,##0.00";
  }

  // Preserve every clearance event rather than flattening multiple dates/references.
  const events = wb.addWorksheet("Clearance Events");
  events.columns = [
    { header: "Country", key: "country", width: 12 },
    { header: "SKU", key: "sku", width: 38 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Production Period", key: "period", width: 20 },
    { header: "Cleared Quantity (MC)", key: "quantity", width: 24 },
    { header: "Cleared Date", key: "date", width: 18 },
    { header: "Invoice Reference", key: "invoice", width: 22 },
    { header: "Container Reference", key: "container", width: 22 },
    { header: "Notes", key: "notes", width: 40 },
  ];
  const skus = new Map(data.skus.map((s) => [s.id, s]));
  const periods = new Map(data.periods.map((p) => [p.id, p]));
  for (const ev of data.clearanceEvents) {
    const sku = skus.get(ev.skuId);
    const period = periods.get(ev.periodId);
    if (!sku || !period) continue;
    const row = events.addRow({
      country: data.country, sku: sku.name, weight: sku.weight, period: period.label,
      quantity: num(ev.clearedQty), date: ev.clearedDate instanceof Date ? isoDate(ev.clearedDate) : ev.clearedDate ?? "",
      invoice: ev.invoiceRef ?? "", container: ev.containerRef ?? "", notes: ev.notes ?? "",
    });
    row.getCell(5).numFmt = "#,##0.00";
  }
  for (const sheet of [ws, events]) {
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount } };
    sheet.getRow(1).height = 32;
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D6B4E" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  }
}
