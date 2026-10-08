import { and, eq, inArray, sql } from "drizzle-orm";
import { actualProductionData, appSettings, auditTrail, clearanceEvents, periods, shipmentData, skus } from "../../drizzle/schema";
import source from "../../attached_assets/libya-supplier-reconciliation-2026-10-08.json";
import { getDb, syncShipmentClearedFromEventsWith } from "../db";

export const LIBYA_SUPPLIER_SOURCE = source;
export const LIBYA_RECEIPT_REPAIR_KEY = "repair.libya.supplier-receipts.2026-10-08";
export type ReceiptRepairDb = Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "transaction">;
type Report = { status: "applied" | "done" | "absent" | "busy" | "inconsistent"; reason?: string };
const numericFields = new Set(["id", "skuId", "periodId", "week1", "week2", "week3", "week4", "clearedQty", "arrivalOffsetValue"]);

/** Compare exact evidence, ignoring timestamps only; never overwrite a later manual correction. */
export function matchesReceiptBaseline(actual: Record<string, unknown>, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const current = actual[key];
    if (value === null) return current === null;
    return numericFields.has(key) ? current != null && Number(current) === Number(value) : current === value;
  });
}

/**
 * One-off DATA correction, not a schema migration. Publishing applies it to live data.
 * All original events are retained in the audit backup. Production/forecast/FOC quantities
 * are unchanged. Supplier lines are deliberately NOT deduplicated: identical rows may
 * represent distinct Old/New packaging, and their totals agree with the original ledger.
 */
export async function runLibyaSupplierReceipts(db: ReceiptRepairDb): Promise<Report> {
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(2026100801) AS locked`);
    if (!(lock as any).rows?.[0]?.locked) return { status: "busy" };
    const [marker] = await tx.select().from(appSettings).where(eq(appSettings.key, LIBYA_RECEIPT_REPAIR_KEY));
    if (marker) return marker.value === source.sourceSha256
      ? { status: "done" } : { status: "inconsistent", reason: "Repair marker differs from supplier evidence." };

    const existing = await tx.select().from(clearanceEvents).where(eq(clearanceEvents.country, "Libya")).for("update");
    if (!existing.some(row => source.beforeClearance.some(old => old.id === row.id))) return { status: "absent" };
    if (existing.length !== source.beforeClearance.length ||
      !source.beforeClearance.every(old => {
        const row = existing.find(event => event.id === old.id);
        return row && matchesReceiptBaseline(row, old);
      })) return { status: "inconsistent", reason: "Libya clearance records changed since the reviewed export." };

    const skuIds = [...new Set(source.beforeShipment.map(row => row.skuId))];
    const masters = await tx.select().from(skus).where(and(eq(skus.country, "Libya"), inArray(skus.id, skuIds)));
    const periodsNeeded = [...new Set(source.beforeShipment.map(row => row.periodId))];
    const countryPeriods = await tx.select().from(periods).where(and(eq(periods.country, "Libya"), inArray(periods.id, periodsNeeded)));
    if (masters.length !== skuIds.length || countryPeriods.length !== periodsNeeded.length ||
      !countryPeriods.every(period => period.year === (period.id === 90012 ? 2025 : 2026) &&
        period.month === period.id - (period.id === 90012 ? 90000 : 90012)) ||
      !source.expectedSkus.every(expected => {
        const master = masters.find(row => row.id === expected.id);
        return master && matchesReceiptBaseline(master, expected);
      }))
      return { status: "inconsistent", reason: "Country-scoped SKU or period identities differ." };
    const currentShipments = await tx.select().from(shipmentData).where(inArray(shipmentData.id, source.beforeShipment.map(row => row.id))).for("update");
    if (currentShipments.length !== source.beforeShipment.length ||
      !source.beforeShipment.every(old => {
        const row = currentShipments.find(shipment => shipment.id === old.id);
        return row && matchesReceiptBaseline(row, old);
      })) return { status: "inconsistent", reason: "Libya production or shipment records changed since review." };
    const futureActuals = await tx.select().from(actualProductionData).where(and(
      inArray(actualProductionData.skuId, skuIds),
      inArray(actualProductionData.periodId, source.future.map(row => row.periodId)),
    ));
    if (futureActuals.some(row => Number(row.value) > 0))
      return { status: "inconsistent", reason: "New actual production was entered for a future batch." };
    if (source.events.length !== 112 || source.events.reduce((sum, row) => sum + Number(row.clearedQty), 0) !== source.totalMC)
      throw new Error("Supplier receipt evidence failed its quantity check.");

    // Preserve the complete original clearance ledger and affected shipments before replacement.
    await tx.insert(auditTrail).values({
      country: "Libya", username: "system:data-repair", action: "supplier_reconciliation", sheet: "Arrival / Clearance",
      oldValue: String(existing.reduce((sum, row) => sum + Number(row.clearedQty), 0)),
      newValue: String(source.totalMC),
      details: JSON.stringify({
        sourceFile: source.sourceFile, sourceSheet: source.sourceSheet, sourceSha256: source.sourceSha256,
        note: "Supplier warehouse receipts are authoritative. June production was received 2026-10-06; September onward remains in transit. Production, forecasts and FOC are unchanged.",
        originalClearanceEvents: existing, originalShipments: currentShipments,
        replacementLineCount: source.events.length,
      }),
    });
    await tx.delete(clearanceEvents).where(and(eq(clearanceEvents.country, "Libya"), inArray(clearanceEvents.id, source.beforeClearance.map(row => row.id))));
    await tx.insert(clearanceEvents).values(source.events.map(({ sourceRow, consignee, item, ...event }) => ({
      ...event, country: "Libya" as const,
      notes: `Supplier warehouse receipt; ${source.sourceSheet} row ${sourceRow}; ${consignee}; ${item}. Source SHA256: ${source.sourceSha256}.`,
    })));
    const historical = source.beforeShipment.filter(row => !source.future.some(future => future.skuId === row.skuId && future.periodId === row.periodId));
    for (const batch of historical) {
      await syncShipmentClearedFromEventsWith(tx, batch.skuId, batch.periodId, "Libya");
      const events = source.events.filter(event => event.skuId === batch.skuId && event.periodId === batch.periodId);
      // Remove phantom "arrived" orphan rows: they never had production, and their
      // wrongly attached events have now been allocated to the genuine batches.
      if (!events.length) await tx.update(shipmentData).set({ arrivalStatus: "Pending", clearedQty: null, clearedDate: null })
        .where(eq(shipmentData.id, batch.id));
      else await tx.update(shipmentData).set({
        clearedDate: events.map(event => event.clearedDate).sort().at(-1)!,
        pendingClearDate: null,
      }).where(eq(shipmentData.id, batch.id));
    }
    for (const batch of source.future) await tx.update(shipmentData).set({
      arrivalStatus: "In Transit", clearedQty: null, clearedDate: null, pendingClearDate: null,
    }).where(and(eq(shipmentData.skuId, batch.skuId), eq(shipmentData.periodId, batch.periodId)));
    await tx.insert(appSettings).values({ key: LIBYA_RECEIPT_REPAIR_KEY, value: source.sourceSha256 });
    return { status: "applied" };
  }, { isolationLevel: "serializable" });
}
