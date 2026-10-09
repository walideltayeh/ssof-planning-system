import ExcelJS from "exceljs";
import { buildBatches, isoDate, num, type PerformanceDataset } from "./analysis/countryPerformance.helpers";
import { arrivalFocMap, combinedArrivalQuantities, arrivalStatusWithFoc } from "../shared/arrivalQuantities";

type ArrivalDataset = Pick<PerformanceDataset, "country" | "skus" | "periods" | "forecast" | "shipment" | "actualProduction" | "clearanceEvents" | "foc">;

/** International Arrival is a batch/clearance view, not Lebanon's weekly grid. */
export function buildInternationalArrivalSheets(wb: ExcelJS.Workbook, data: ArrivalDataset) {
  const foc = arrivalFocMap(data.country, data.foc);
  const paidForecast = new Map(data.forecast.map(row => [`${row.skuId}-${row.periodId}`, num(row.value)]));
  // Seed plans so FOC-only batches also surface. Recalculate below using paid
  // quantities, adding FOC exactly once even when actual production overrides plan.
  const forecast = [...new Set([...paidForecast.keys(), ...foc.keys()])].map(key => {
    const [skuId, periodId] = key.split("-").map(Number);
    return { skuId, periodId, value: String((paidForecast.get(key) ?? 0) + (foc.get(key) ?? 0)) };
  });
  const batches = buildBatches({ ...data, forecast, ims: [], arrival: [], planningFg: [], now: new Date() }, data.skus);
  for (const batch of batches) {
    const key = `${batch.sku.id}-${batch.period.id}`;
    const quantities = combinedArrivalQuantities(paidForecast.get(key) ?? 0, batch.actualMc, foc.get(key) ?? 0);
    batch.plannedMc = quantities.plannedTotal;
    batch.actualMc = quantities.actualTotal;
    batch.producedMc = quantities.total;
    batch.pendingMc = Math.max(0, quantities.total - batch.clearedMc);
    batch.status = arrivalStatusWithFoc(batch.status, quantities.focTotal, quantities.total, batch.clearedMc);
  }
  const ws = wb.addWorksheet("Arrival");
  ws.columns = [
    { header: "Country", key: "country", width: 12 },
    { header: "SKU", key: "sku", width: 38 },
    { header: "Weight", key: "weight", width: 10 },
    { header: "Packaging", key: "packaging", width: 12 },
    { header: "Production Period", key: "period", width: 20 },
    { header: data.country === "Syria" ? "Planned Production + FOC (MC)" : "Planned Production (MC)", key: "planned", width: 28 },
    { header: data.country === "Syria" ? "Actual Production + FOC (MC)" : "Actual Production (MC)", key: "actual", width: 28 },
    { header: "Batch Quantity (MC)", key: "quantity", width: 22 },
    { header: "Expected Arrival", key: "expected", width: 18 },
    { header: "Status", key: "status", width: 24 },
    { header: "Cleared Quantity (MC)", key: "cleared", width: 22 },
    { header: "Pending Quantity (MC)", key: "pending", width: 22 },
    { header: "Last Cleared Date", key: "clearedDate", width: 18 },
    { header: "Invoice Reference", key: "invoice", width: 22 },
    { header: "Container Reference", key: "container", width: 22 },
    { header: "Notes", key: "notes", width: 40 },
    ...(data.country === "Syria" ? [
      { header: "Production excluding FOC (MC)", key: "productionOnly", width: 28 },
      { header: "FOC (MC)", key: "foc", width: 16 },
    ] : []),
  ];
  for (const b of batches) {
    const row = ws.addRow({
      country: data.country, sku: b.sku.name, weight: b.sku.weight, packaging: b.sku.packagingType ?? "New",
      period: b.period.label, planned: b.plannedMc, actual: b.actualMc, quantity: b.producedMc,
      expected: isoDate(b.expectedArrival) ?? "",
      status: b.producedMc <= 0 && b.eventCount > 0 ? "No production — events" : b.actualMc <= 0 && b.status !== "In Transit" ? "Awaiting Actual" : b.status,
      cleared: b.clearedMc, pending: b.pendingMc, clearedDate: isoDate(b.lastClearedDate) ?? "",
      invoice: b.invoiceRef ?? "", container: b.containerRef ?? "", notes: b.note ?? "",
      productionOnly: b.producedMc - (foc.get(`${b.sku.id}-${b.period.id}`) ?? 0),
      foc: foc.get(`${b.sku.id}-${b.period.id}`) ?? 0,
    });
    for (const col of [6, 7, 8, 11, 12]) row.getCell(col).numFmt = "#,##0.00";
    if (data.country === "Syria") for (const col of [17, 18]) row.getCell(col).numFmt = "#,##0.00";
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
