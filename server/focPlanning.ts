import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { getDb } from "./db";
import { auditTrail, focData, forecastData, periods, skus, ssofVersions } from "../drizzle/schema";
import { matchLibyaPo, LIBYA_PO_REFERENCE, LIBYA_PO_ROUNDING_NOTE, LIBYA_PO_SPLIT } from "../shared/libyaPurchaseOrder";
import { supportsFoc, type FocCountry } from "../shared/performance/foc";
import { loadFocReceiptData } from "./focReceiptService";
import { summarizeFocReceipts } from "../shared/performance/focReceipts";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db;
}
export async function getFocPlanning(country: FocCountry, includeFoc = true) {
  const ds = await loadFocReceiptData(country);
  return { skus: ds.skus, periods: ds.periods, cells: ds.foc, receipts: summarizeFocReceipts(ds, includeFoc) };
}
export async function setFocCell(country: FocCountry, skuId: number, periodId: number, value: number | null, actor: string) {
  if (!supportsFoc(country)) throw new Error("FOC is available only for Libya and Syria");
  const db = await database();
  return db.transaction(async tx => {
    const [s] = await tx.select().from(skus).where(and(eq(skus.id, skuId), eq(skus.country, country), eq(skus.isActive, true))).for("update");
    const [p] = await tx.select().from(periods).where(and(eq(periods.id, periodId), eq(periods.country, country)));
    if (!s || !p) throw new Error("SKU or month is not active in this country");
    const where = and(eq(focData.country, country), eq(focData.skuId, skuId), eq(focData.periodId, periodId));
    const [old] = await tx.select().from(focData).where(where);
    const next = value === null ? null : value.toFixed(2);
    if ((old?.value ?? null) === next) return { success: true };
    await tx.insert(focData).values({ country, skuId, periodId, value: next }).onConflictDoUpdate({
      target: [focData.country, focData.skuId, focData.periodId], set: { value: next,
        ...(next === null ? { received: false } : {}), updatedAt: new Date() },
    });
    await tx.insert(auditTrail).values({ country, username: actor, action: "edit_cell", sheet: "FOC", skuName: `${s.name} ${s.weight} (${s.packagingType})`,
      periodLabel: p.label, field: "FOC MC", oldValue: old?.value ?? "not set", newValue: next ?? "not set",
      details: JSON.stringify({ receivedBefore: old?.received ?? false, receivedAfter: next === null ? false : old?.received ?? false,
        note: "Receipt review re-evaluated against changed quantity. Received FOC affects stock only when included and duplicate-checked; no sell-out created." }) });
    return { success: true };
  });
}

const poAuditWhere = and(eq(auditTrail.country, "Libya"), eq(auditTrail.action, "import_purchase_order"), eq(auditTrail.field, LIBYA_PO_REFERENCE));
async function previewWith(db: Awaited<ReturnType<typeof database>>) {
  const [ss, ps, fs, fc, previous] = await Promise.all([
    db.select().from(skus).where(eq(skus.country, "Libya")),
    db.select().from(periods).where(eq(periods.country, "Libya")),
    db.select({ id: forecastData.id, skuId: forecastData.skuId, periodId: forecastData.periodId, value: forecastData.value }).from(forecastData)
      .innerJoin(skus, eq(skus.id, forecastData.skuId)).where(eq(skus.country, "Libya")),
    db.select().from(focData).where(eq(focData.country, "Libya")),
    db.select().from(auditTrail).where(poAuditWhere),
  ]);
  const rows = matchLibyaPo(ss, ps).map(r => {
    const existing = fs.filter(f => f.skuId === r.skuId && f.periodId === r.periodId);
    if (existing.length > 1) throw new Error(`Duplicate forecast cells for ${r.sku} ${r.month}; import stopped.`);
    return { ...r, before: Number(existing[0]?.value ?? 0), beforeFoc: fc.find(f => f.skuId === r.skuId && f.periodId === r.periodId)?.value ?? null };
  });
  const token = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
  return { reference: LIBYA_PO_REFERENCE, rows, token, importedBefore: previous.length > 0,
    applied: previous.length > 0 && rows.every(r => r.before === r.ordered && Number(r.beforeFoc) === r.foc && r.beforeFoc !== null),
    split: LIBYA_PO_SPLIT, note: LIBYA_PO_ROUNDING_NOTE };
}
export async function previewLibyaPo() { return previewWith(await database()); }

/** User-authorized business import, no schema changes. All writes and backup are atomic. */
export async function importLibyaPo(actor: string, token?: string, onlyExpectedZeroState = false) {
  const db = await database();
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(260370111)`);
    // Same row lock as forecast/FOC editing: prevent a concurrent edit being overwritten.
    await tx.select().from(skus).where(eq(skus.country, "Libya")).for("update");
    const preview = await previewWith(tx as unknown as typeof db);
    if (onlyExpectedZeroState && preview.importedBefore) return { success: true, alreadyApplied: true, versionId: null };
    if (preview.applied) return { success: true, alreadyApplied: true, versionId: null };
    if (onlyExpectedZeroState && preview.rows.some(r => r.before !== 0 || r.beforeFoc !== null)) return { success: false, alreadyApplied: false, versionId: null };
    if (token !== undefined && token !== preview.token) throw new Error("Values changed since preview. Review the before-and-after figures again.");
    const snapshot = await tx.execute(sql`
      SELECT json_build_object(
        'skus',(SELECT coalesce(json_agg(s),'[]') FROM skus s WHERE country='Libya'),
        'periods',(SELECT coalesce(json_agg(p),'[]') FROM periods p WHERE country='Libya'),
        'forecast',(SELECT coalesce(json_agg(f),'[]') FROM forecast_data f JOIN skus s ON s.id=f."skuId" WHERE s.country='Libya'),
        'ims',(SELECT coalesce(json_agg(f),'[]') FROM ims_data f JOIN skus s ON s.id=f."skuId" WHERE s.country='Libya'),
        'shipment',(SELECT coalesce(json_agg(f),'[]') FROM shipment_data f JOIN skus s ON s.id=f."skuId" WHERE s.country='Libya'),
        'arrival',(SELECT coalesce(json_agg(f),'[]') FROM arrival_data f JOIN skus s ON s.id=f."skuId" WHERE s.country='Libya'),
        'planningFg',(SELECT coalesce(json_agg(f),'[]') FROM planning_fg_data f JOIN skus s ON s.id=f."skuId" WHERE s.country='Libya'),
        'actualProduction',(SELECT coalesce(json_agg(f),'[]') FROM actual_production_data f JOIN skus s ON s.id=f."skuId" WHERE s.country='Libya'),
        'clearanceEvents',(SELECT coalesce(json_agg(f),'[]') FROM clearance_events f JOIN skus s ON s.id=f."skuId" WHERE s.country='Libya'),
        'foc',(SELECT coalesce(json_agg(f),'[]') FROM foc_data f WHERE country='Libya')
      ) AS snapshot`);
    const [version] = await tx.insert(ssofVersions).values({ country: "Libya", name: `Before PO ${LIBYA_PO_REFERENCE}`, savedBy: actor,
      description: "Rollback snapshot saved before replacing the 16 ordered forecast cells and setting 16 separate planned FOC cells.",
      snapshotData: snapshot.rows[0].snapshot, changesSummary: { purchaseOrder: preview } }).returning({ id: ssofVersions.id });
    for (const r of preview.rows) {
      const where = and(eq(forecastData.skuId, r.skuId), eq(forecastData.periodId, r.periodId));
      const changed = await tx.update(forecastData).set({ value: r.ordered.toFixed(2), updatedAt: new Date() }).where(where).returning({ id: forecastData.id });
      if (!changed.length) await tx.insert(forecastData).values({ skuId: r.skuId, periodId: r.periodId, value: r.ordered.toFixed(2) });
      await tx.insert(focData).values({ country: "Libya", skuId: r.skuId, periodId: r.periodId, value: r.foc.toFixed(2) }).onConflictDoUpdate({
        target: [focData.country, focData.skuId, focData.periodId], set: { value: r.foc.toFixed(2), updatedAt: new Date() },
      });
      for (const [sheet, oldValue, newValue] of [["Forecast Production", String(r.before), String(r.ordered)], ["FOC", r.beforeFoc ?? "not set", String(r.foc)]]) {
        await tx.insert(auditTrail).values({ country: "Libya", username: actor, action: "edit_cell", sheet, skuName: r.sku,
          periodLabel: r.month, field: LIBYA_PO_REFERENCE, oldValue, newValue, details: `${LIBYA_PO_ROUNDING_NOTE} Before-import version ${version.id}.` });
      }
    }
    await tx.insert(auditTrail).values({ country: "Libya", username: actor, action: "import_purchase_order", sheet: "Forecast Production + FOC",
      field: LIBYA_PO_REFERENCE, details: JSON.stringify({ ...preview, versionId: version.id }) });
    return { success: true, alreadyApplied: false, versionId: version.id };
  });
}

/** On publish, apply only the exact zero state shown to and approved by the user.
 * An audit marker prevents reapplication, including after restoring the backup.
 */
export async function applyApprovedLibyaPoOnBoot() {
  try {
    const result = await importLibyaPo("system:approved-libya-po", undefined, true);
    console.info(`[Libya PO] ${result.alreadyApplied ? "Already applied; unchanged." : result.success ? `Applied with backup version ${result.versionId}.` : "Current values differ from approved zero-state preview; use the admin preview to review them."}`);
  } catch (error) {
    console.warn("[Libya PO] Import not applied:", error instanceof Error ? error.message : "Unknown error");
  }
}
