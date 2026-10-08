import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { appSettings, auditTrail, clearanceEvents, periods, shipmentData, skus } from "../../drizzle/schema";
import { LIBYA_RECEIPT_REPAIR_KEY, LIBYA_SUPPLIER_SOURCE as source, matchesReceiptBaseline, runLibyaSupplierReceipts } from "./libyaSupplierReceipts";

describe("Libya supplier evidence", () => {
  it("preserves all 112 real supplier lines, dates, quantities, invoices and containers", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(source.sourceFile);
    const sheet = wb.getWorksheet(source.sourceSheet)!;
    expect(source.events).toHaveLength(112);
    expect(source.events.reduce((total, event) => total + Number(event.clearedQty), 0)).toBe(189222);
    for (const event of source.events) {
      const row = sheet.getRow(event.sourceRow);
      expect(Number(event.clearedQty)).toBe(row.getCell(4).value);
      expect(event.clearedDate).toBe((row.getCell(1).value as Date).toISOString().slice(0, 10));
      expect(event.invoiceRef).toBe(String(row.getCell(6).value).trim());
      expect(event.containerRef).toBe(String(row.getCell(5).value).trim());
      expect(event.item).toBe(row.getCell(3).value);
    }
  });
  it("allocates exact production batches, including October receipts to June, not September", () => {
    const totals = new Map<string, number>();
    for (const event of source.events) {
      const key = `${event.skuId}-${event.periodId}`;
      totals.set(key, (totals.get(key) ?? 0) + Number(event.clearedQty));
      expect(event.periodId).toBeLessThanOrEqual(90018);
    }
    expect(totals.get("240001-90015")).toBe(14000);
    expect(totals.get("240001-90016")).toBe(2000);
    expect(totals.get("240001-90017")).toBe(24000);
    expect(totals.get("240001-90018")).toBe(69400);
    expect(totals.get("240010-90015")).toBe(3500);
    expect(totals.get("240010-90016")).toBe(4500);
    expect(totals.get("240010-90017")).toBe(1000);
    expect(totals.get("240010-90018")).toBe(22469);
    expect(totals.get("240015-90017")).toBe(334);
    expect(totals.get("240015-90018")).toBe(217);
    expect(source.events.filter(event => event.clearedDate === "2026-10-06").reduce((n, event) => n + Number(event.clearedQty), 0)).toBe(102885);
  });
  it("keeps the previous Old/New packaging totals and never deduplicates legitimate same-invoice lines", () => {
    for (const sku of source.expectedSkus) {
      const oldQty = source.beforeClearance.filter(row => row.skuId === sku.id).reduce((n, row) => n + Number(row.clearedQty), 0);
      const newQty = source.events.filter(row => row.skuId === sku.id).reduce((n, row) => n + Number(row.clearedQty), 0);
      expect(newQty).toBe(oldQty);
    }
    expect(source.events.filter(row => row.sourceRow === 10 || row.sourceRow === 11).map(row => row.skuId)).toEqual([240001, 240004]);
  });
  it("rejects edited evidence while accepting equivalent database numeric strings", () => {
    expect(matchesReceiptBaseline({ clearedQty: "500.00", notes: null }, { clearedQty: 500, notes: null })).toBe(true);
    expect(matchesReceiptBaseline({ clearedQty: "501.00", notes: null }, { clearedQty: 500, notes: null })).toBe(false);
    expect(matchesReceiptBaseline({ clearedQty: "500.00", notes: "new manual edit" }, { clearedQty: 500, notes: null })).toBe(false);
  });
});

// Exercise the real PostgreSQL transaction and real synchronization helper against
// TEMPORARY shadows, never the user's tables. Roll back every rehearsal completely.
class RollbackRehearsal extends Error {}
async function rehearse(check: (tx: any, repair: () => ReturnType<typeof runLibyaSupplierReceipts>) => Promise<void>) {
  const db = await getDb();
  if (!db) throw new Error("Development database is required for a receipt repair rehearsal.");
  try {
    await db.transaction(async tx => {
      for (const table of ["skus", "periods", "clearance_events", "shipment_data", "actual_production_data", "app_settings", "audit_trail"]) {
        await tx.execute(sql.raw(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`));
      }
      await tx.insert(skus).values(source.expectedSkus.map(row => ({ ...row, country: "Libya" as const, packagingType: row.packagingType as "Old" | "New" })));
      await tx.insert(periods).values([...new Set(source.beforeShipment.map(row => row.periodId))].map(id => ({
        id, country: "Libya" as const, year: id === 90012 ? 2025 : 2026,
        month: id - (id === 90012 ? 90000 : 90012), label: `Fixture ${id}`, sortOrder: id,
      })));
      await tx.insert(clearanceEvents).values(source.beforeClearance.map(row => ({ ...row, country: "Libya" as const, clearedQty: String(row.clearedQty) })));
      await tx.insert(shipmentData).values(source.beforeShipment.map(row => ({
        ...row, arrivalStatus: row.arrivalStatus as "Pending" | "Cleared",
        week1: String(row.week1), week2: String(row.week2), week3: String(row.week3), week4: String(row.week4),
        clearedQty: row.clearedQty == null ? null : String(row.clearedQty),
      })));
      await tx.insert(clearanceEvents).values({ id: 777777, skuId: 888888, periodId: 888888, country: "Syria", clearedQty: "25", clearedDate: "2026-09-01" });
      await check(tx, () => runLibyaSupplierReceipts({ transaction: (async (fn: any) => fn(tx)) as any }));
      throw new RollbackRehearsal();
    }, { isolationLevel: "serializable" });
  } catch (error) {
    if (!(error instanceof RollbackRehearsal)) throw error;
  }
}

describe("atomic guarded supplier correction (real database, rolled back)", () => {
  it("corrects all lines and statuses once, saves the original history, and leaves other countries unchanged", async () => {
    await rehearse(async (tx, repair) => {
      expect((await repair()).status).toBe("applied");
      const rows = await tx.select().from(clearanceEvents).where(eq(clearanceEvents.country, "Libya"));
      expect(rows).toHaveLength(112);
      expect(rows.reduce((n: number, row: any) => n + Number(row.clearedQty), 0)).toBe(189222);
      const june = rows.filter((row: any) => row.periodId === 90018);
      expect(june.every((row: any) => row.clearedDate === "2026-10-06")).toBe(true);
      const shipments = await tx.select().from(shipmentData);
      for (const future of source.future) {
        const row = shipments.find((shipment: any) => shipment.skuId === future.skuId && shipment.periodId === future.periodId);
        expect(row.arrivalStatus).toBe("In Transit");
        expect(row.clearedQty).toBeNull();
        expect(row.clearedDate).toBeNull();
        expect(Number(row.week1) + Number(row.week2) + Number(row.week3) + Number(row.week4)).toBe(0);
      }
      for (const old of source.beforeShipment) {
        const row = shipments.find((shipment: any) => shipment.id === old.id);
        expect([row.week1, row.week2, row.week3, row.week4].map(Number)).toEqual([old.week1, old.week2, old.week3, old.week4]);
      }
      const [foreign] = await tx.select().from(clearanceEvents).where(eq(clearanceEvents.country, "Syria"));
      expect(foreign).toMatchObject({ id: 777777, clearedQty: "25.00" });
      const [audit] = await tx.select().from(auditTrail);
      expect(JSON.parse(audit.details).originalClearanceEvents).toHaveLength(36);
      expect((await repair()).status).toBe("done");
      expect(await tx.select().from(clearanceEvents).where(eq(clearanceEvents.country, "Libya"))).toHaveLength(112);
    });
  });
  it("does not modify anything if even one reviewed event has changed", async () => {
    await rehearse(async (tx, repair) => {
      await tx.update(clearanceEvents).set({ notes: "later manual correction" }).where(eq(clearanceEvents.id, source.beforeClearance[0].id));
      expect((await repair()).status).toBe("inconsistent");
      expect(await tx.select().from(clearanceEvents).where(eq(clearanceEvents.country, "Libya"))).toHaveLength(36);
      expect(await tx.select().from(auditTrail)).toHaveLength(0);
      expect(await tx.select().from(appSettings).where(eq(appSettings.key, LIBYA_RECEIPT_REPAIR_KEY))).toHaveLength(0);
    });
  });
  it("rolls back replacement, derived status, audit and marker together on a database failure", async () => {
    await rehearse(async (tx, repair) => {
      await tx.execute(sql.raw("ALTER TABLE pg_temp.app_settings ADD CONSTRAINT reject_repair_marker CHECK (key <> 'repair.libya.supplier-receipts.2026-10-08')"));
      await tx.execute(sql`SAVEPOINT receipt_failure`);
      await expect(repair()).rejects.toThrow();
      await tx.execute(sql`ROLLBACK TO SAVEPOINT receipt_failure`);
      expect(await tx.select().from(clearanceEvents).where(eq(clearanceEvents.country, "Libya"))).toHaveLength(36);
      expect(await tx.select().from(auditTrail)).toHaveLength(0);
      expect(await tx.select().from(appSettings)).toHaveLength(0);
    });
  });
});
