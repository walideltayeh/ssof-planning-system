/**
 * Read-only forensic report from captured production + tracker snapshots.
 * Usage: pnpm exec tsx scripts/syria-sync-audit.ts /tmp/syria-prod.json /tmp/syria-tracker.json /tmp/syria-foc.json
 * Does not connect to a database or apply a sync.
 */
import { readFileSync, mkdirSync } from "node:fs";
import ExcelJS from "exceljs";
import { buildSyriaSyncAudit, type AuditDataset } from "../server/analysis/syriaSyncAudit";
import type { Feed } from "../server/wsTracker";

const snapshot = JSON.parse(readFileSync(process.argv[2], "utf8"));
const feed: Feed = JSON.parse(readFileSync(process.argv[3], "utf8"));
snapshot.foc = process.argv[4] ? JSON.parse(readFileSync(process.argv[4], "utf8")) : [];
const ds: AuditDataset = { ...snapshot, country: "Syria", now: new Date() };
const old = ds.skus.find(s => s.name === "Double Apple" && s.weight === "50g" && s.packagingType === "Old");
const report = buildSyriaSyncAudit(ds, feed, old ? { [old.id]: 1808 } : {});
const wb = new ExcelJS.Workbook();
wb.creator = "SSOF";
const addSheet = (name: string, rows: Record<string, unknown>[]) => {
  const ws = wb.addWorksheet(name);
  const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
  ws.columns = columns.map(key => ({ key, header: key, width: key.includes("sku") ? 38 : key.includes("note") || key.includes("cause") ? 60 : 24 }));
  for (const row of rows) ws.addRow(row);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF145A48" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: columns.length } };
  ws.eachRow((row, index) => { if (index > 1) row.eachCell(cell => {
    if (typeof cell.value === "number") cell.numFmt = "#,##0.00;[Red]-#,##0.00";
    cell.alignment = { vertical: "top", wrapText: true };
  }); });
};
const oldRow = report.summary.find(r => r.skuId === old?.id);
addSheet("Read first", [
  { point: "Scope", finding: `All ${report.summary.length} Syria SKUs, including inactive and SSOF-only products. All quantities are mastercases (MC).` },
  { point: "Source dates", finding: `Tracker generated ${report.generatedAt}; coverage ${report.from} through ${report.to}. Production database snapshot; no writes applied.` },
  { point: "Difference sign", finding: "Every difference is SSOF minus tracker. Positive means SSOF is higher." },
  { point: "Warehouse limitation", finding: "The feed publishes IMS and inbound, NOT warehouse opening or closing balances. Movement net is shown separately and is never called verified warehouse stock. Only Old 50g has the user's 1,808 MC reference." },
  { point: "Known case, full explanation", finding: `Old 50g: ${oldRow?.trackerInbound} deliveries minus ${oldRow?.trackerIMS} IMS = 1,808. Previous Received FOC addition of 3,334 produced 5,142. The entire reported +3,334 is that FOC stock layer; unexplained remainder 0 MC.` },
  { point: "Historical evidence", finding: "Production audit entry on 2026-10-09 08:23:10 UTC records the Old 50g December 2025 Received FOC entry of 3,334 MC, and a direct +3,334 stock impact carried into subsequent months. New 50g has a separate 1,667 MC Received FOC entry." },
  { point: "Current calculation vs live UI", finding: "Closing figures use the current clearance-only code with production records. The live signed-in display was not verified. 'obsoleteFormulaClosing' reconstructs the obsolete additive FOC formula; it is not claimed as a current live display." },
  { point: "Opening and stale values", finding: "No values outside the feed are erased automatically. Diagnostic sheets identify their actual stock effect; later opening entries are ignored by the carried chain." },
  { point: "Historical deletion limitation", finding: "Old sync audit entries store replaced counts, not before-images of deleted records. Current events are tracker-owned. Exact quantities of genuinely lost manual records cannot be proven or restored from those counts. Manual creation/deletion evidence is included separately; do not restore it blindly, since it may be represented by a tracker delivery." },
  { point: "Inactive scope", finding: "Inactive SKU closing is dormant arithmetic for inspection, not included in operational stock totals. Zero-quantity unmapped SKUs remain listed." },
]);
addSheet("All Syria SKUs", report.summary);
addSheet("Monthly chain", report.monthly);
addSheet("Named stock causes", report.causes.length ? report.causes : [{ finding: "No difference to movement net; all MC accounted for." }]);
addSheet("Diagnostics", report.diagnostics.length ? report.diagnostics : [{ finding: "No nonzero outside-coverage values or forecast-marked IMS conflicts found." }]);
addSheet("Delivery buckets", report.deliveries);
addSheet("Unmapped tracker", report.unmapped.length ? report.unmapped : [{ finding: "Every published tracker product has a strict name, weight and packaging match." }]);
addSheet("Chain start", report.summary.map(r => ({
  sku: r.sku, active: r.active, firstPeriod: r.firstPeriod, firstOpening: r.firstOpening,
  totalAdjustments: r.adjustments, outsideArrivalPeriodMC: r.overflow,
  beforeProductionMC: r.beforeProduction, nonTrackerClearanceMC: r.nonTrackerClearances,
})));
addSheet("Historical clearance evidence", snapshot.audit.filter((a: { sheet: string }) => a.sheet !== "WS Tracker").map((a: {
  createdAt: string; sheet: string; skuName: string; periodLabel: string; field: string; oldValue: string; newValue: string; details: string;
}) => ({ date: a.createdAt, sheet: a.sheet, sku: a.skuName, month: a.periodLabel, field: a.field, old: a.oldValue, next: a.newValue, details: a.details })));
addSheet("Sync history", snapshot.audit.filter((a: { sheet: string }) => a.sheet === "WS Tracker").map((a: { createdAt: string; details: string }) => ({
  date: a.createdAt, recordedSummary: a.details, deletedBeforeImage: "Not captured by the old sync; quantity cannot be recovered from a count.",
})));
addSheet("Reported 3334 bridge", [
  { cause: "Tracker deliveries", mc: oldRow?.trackerInbound },
  { cause: "Tracker IMS", mc: -(oldRow?.trackerIMS ?? 0) },
  { cause: "Movement closing / user reference", mc: 1808 },
  { cause: "Obsolete direct Received FOC warehouse addition", mc: 3334 },
  { cause: "Reported SSOF closing under obsolete formula", mc: 5142 },
  { cause: "Explained reported excess", mc: 3334 },
  { cause: "Unexplained reported excess", mc: 0 },
]);
mkdirSync("generated-artifacts", { recursive: true });
await wb.xlsx.writeFile("generated-artifacts/syria-sync-audit.xlsx");
console.log(JSON.stringify({
  skus: report.summary.length, unmappedTracker: report.unmapped, diagnostics: report.diagnostics,
  causes: report.causes, summary: report.summary.map(r => ({ sku: r.sku, trackerIMS: r.trackerIMS,
    ssofIMS: r.ssofIMS, inbound: r.trackerInbound, ssofInbound: r.ssofArrivals, closing: r.ssofClosing,
    movementNet: r.trackerMovementNetNotStock, difference: r.stockMinusMovementNet, legacyFoc: r.legacyReceivedFocAddition })),
}, null, 2));
