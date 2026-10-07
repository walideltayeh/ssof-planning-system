import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { loadFocReceiptData } from "./focReceiptService";
import { auditTrail, focData, forecastData, imsData, skus, ssofVersions } from "../drizzle/schema";
import { changeFocCell, matchFocDrafts, recordedFocLines, receivedFocMC, type FocDraft } from "../shared/focEntry";
import { mcPrecision, type FocCountry, type FocCell } from "../shared/performance/foc";
import { evaluateFocReceipts } from "../shared/performance/focReceipts";
import { buildStockLedger, type StockDataset } from "../shared/performance/stock";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type CellChange = { skuId: number; periodId: number; value?: number | null; received?: boolean; lineId?: string; remove?: boolean; decision?: "separate" | "included"; reviewKey?: string };
export type FocOperation = { lines: FocDraft[] } | { cell: CellChange };
async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}
function bad(message: string): never { throw new TRPCError({ code: "BAD_REQUEST", message }); }

export function stockImpact(before: StockDataset, after: StockDataset, affected: Map<number, number>) {
  const a = buildStockLedger(before), b = buildStockLedger(after);
  return [...affected.keys()].flatMap(skuId => {
    const sku = before.skus.find(s => s.id === skuId) as typeof before.skus[number] & { name?: string; weight?: string; packagingType?: string | null };
    return before.periods.slice().sort((x, y) => x.sortOrder - y.sortOrder).flatMap(p => {
      if (p.sortOrder < affected.get(skuId)!) return [];
      const first = a.bySku.get(skuId)?.get(p.id), second = b.bySku.get(skuId)?.get(p.id);
      if (!first || !second) return [];
      return [{ skuId, sku: `${sku.name} · ${sku.weight} · ${sku.packagingType ?? "New"}`, periodId: p.id,
        month: (p as typeof p & { label?: string }).label ?? `${p.year}-${p.month}`, before: first.closing, after: second.closing,
        beforeArrivals: first.arrivals, afterArrivals: second.arrivals }];
    });
  });
}

async function previewWith(db: Db, country: FocCountry, operation: FocOperation, includeFoc: boolean) {
  const ds = await loadFocReceiptData(country, db);
  const [ims, forecast] = await Promise.all([
    db.select({ row: imsData }).from(imsData).innerJoin(skus, eq(skus.id, imsData.skuId)).where(eq(skus.country, country)),
    db.select({ row: forecastData }).from(forecastData).innerJoin(skus, eq(skus.id, forecastData.skuId)).where(eq(skus.country, country)),
  ]);
  // Include inactive identities only for explicit pasted-row validation, never in the stock ledger.
  const matchSkus = "lines" in operation ? await db.select().from(skus).where(eq(skus.country, country)) : ds.skus;
  const rows = "lines" in operation ? matchFocDrafts(operation.lines, matchSkus, ds.periods, country) : [];
  const next = new Map(ds.foc.map(c => [`${c.skuId}-${c.periodId}`, c as FocCell]));
  const affected = new Map<number, number>();
  if ("lines" in operation) {
    for (const r of rows) {
      if (r.errors.length || r.skuId === null || r.periodId === null) continue;
      const key = `${r.skuId}-${r.periodId}`;
      const old = next.get(key) ?? { skuId: r.skuId, periodId: r.periodId, value: null, country };
      const lines = [...recordedFocLines(old), { id: `preview-${r.row}`, quantityMC: r.quantity, received: r.received,
        date: r.date, flavor: r.flavor, weight: r.weight, packaging: r.packaging,
        accType: r.accType, salesManager: r.salesManager, source: "Recorded FOC" as const, actor: "", recordedAt: "" }];
      const value = mcPrecision((Number(old.value) || 0) + r.quantity);
      if (value > 9999999999.99) bad("The combined FOC quantity exceeds the maximum. No lines were saved.");
      next.set(key, { ...old, value: value.toFixed(2), lines, received: receivedFocMC({ ...old, lines }) === value });
      affected.set(r.skuId, Math.min(affected.get(r.skuId) ?? Infinity, ds.periods.find(p => p.id === r.periodId)!.sortOrder));
    }
  } else {
    const c = operation.cell;
    if (!ds.skus.some(s => s.id === c.skuId) || !ds.periods.some(p => p.id === c.periodId)) bad("SKU or month does not belong to this country.");
    const key = `${c.skuId}-${c.periodId}`, old = next.get(key) ?? { skuId: c.skuId, periodId: c.periodId, value: null, country };
    if (c.received !== undefined && (old.value === null || Number(old.value) <= 0)) bad("Enter an FOC quantity before changing its receipt.");
    let changed = changeFocCell(old, c, "", "", "preview-grid");
    if (Number(changed.value) > 9999999999.99) bad("The combined FOC quantity exceeds the maximum. No lines were saved.");
    if (c.decision) {
      const entries = evaluateFocReceipts(ds).filter(e => e.skuId === c.skuId && e.periodId === c.periodId);
      const entry = c.lineId ? entries.find(e => e.lineId === c.lineId) : entries.find(e => e.needsReview) ?? entries[0];
      if (!entry?.received || (!entry.matches.length && !entry.needsReview)) bad("No received FOC duplicate warning to review.");
      if (entry.reviewKey !== c.reviewKey) throw new TRPCError({ code: "CONFLICT", message: "Arrival evidence changed. Reload and review again." });
      if (c.decision === "included" && !entry.matches.some(m => m.source.includes("clearance") || m.source === "Clearance arrival"))
        bad("There is no matching stock-counted clearance arrival.");
      changed = { ...changed, lines: changed.lines?.map(l => l.id === (entry.lineId ?? "existing")
        ? { ...l, receiptDecision: c.decision, receiptReviewKey: entry.reviewKey } : l) };
    }
    next.set(key, changed);
    affected.set(c.skuId, ds.periods.find(p => p.id === c.periodId)!.sortOrder);
  }
  const before: StockDataset = { ...ds, ims: ims.map(r => r.row), forecast: forecast.map(r => r.row), includeFoc, now: new Date() };
  const after = { ...before, foc: [...next.values()] };
  const impact = stockImpact(before, after, affected);
  const warnings = evaluateFocReceipts(after, includeFoc).filter(e => affected.has(e.skuId) && e.needsReview);
  // Bind confirmation to every source used by the preview, the exact operation and the display basis.
  const token = createHash("sha256").update(JSON.stringify({ country, operation, includeFoc, ds, ims, forecast, impact, warnings })).digest("hex");
  return { token, canSave: rows.every(r => !r.errors.length) && ("cell" in operation || rows.length > 0),
    rows, impact, warnings, next, original: ds };
}
const publicPreview = (p: Awaited<ReturnType<typeof previewWith>>) => ({ token: p.token, canSave: p.canSave, rows: p.rows, impact: p.impact, warnings: p.warnings });
export async function previewFocEntry(country: FocCountry, operation: FocOperation, includeFoc: boolean) {
  return publicPreview(await previewWith(await database(), country, operation, includeFoc));
}

/** Country-only FOC backup: restoring it never overwrites paid forecast, IMS or tracker data. */
export async function saveFocBackup(db: Db, country: FocCountry, actor: string, summary: unknown) {
  const cells = await db.select().from(focData).where(eq(focData.country, country));
  const [version] = await db.insert(ssofVersions).values({ country, name: `Before FOC entry · ${new Date().toISOString()}`,
    savedBy: actor, description: "FOC-only rollback snapshot, including every recorded line and receipt decision. Other planning sheets remain untouched.",
    snapshotData: { focOnly: true, country, foc: cells }, changesSummary: summary }).returning({ id: ssofVersions.id });
  return version.id;
}
export async function commitFocEntry(country: FocCountry, operation: FocOperation, includeFoc: boolean, actor: string, token?: string) {
  const db = await database();
  return db.transaction(async tx => {
    const connection = tx as unknown as Db;
    await tx.select().from(skus).where(eq(skus.country, country)).for("update");
    const result = await previewWith(connection, country, operation, includeFoc);
    if (!result.canSave) bad("Resolve every unmatched or invalid line before saving. No lines were saved.");
    if (token !== undefined && token !== result.token) throw new TRPCError({ code: "CONFLICT", message: "FOC or stock data changed since preview. Preview again before saving." });
    const versionId = await saveFocBackup(connection, country, actor, publicPreview(result));
    const now = new Date(), recordedAt = now.toISOString();
    const ids = new Map<string, string>();
    const warnings = result.warnings.map(w => {
      if (!w.lineId?.startsWith("preview-")) return w;
      const key = `${w.skuId}-${w.periodId}-${w.lineId}`;
      if (!ids.has(key)) ids.set(key, randomUUID());
      return { ...w, lineId: ids.get(key)! };
    });
    for (const [key, cell] of result.next) {
      const original = result.original.foc.find(c => `${c.skuId}-${c.periodId}` === key);
      if (JSON.stringify(original) === JSON.stringify(cell)) continue;
      const lines = (cell.lines ?? []).map(l => l.id.startsWith("preview-") ? { ...l,
        id: ids.get(`${cell.skuId}-${cell.periodId}-${l.id}`) ?? randomUUID(), actor, recordedAt } : l);
      if (cell.value === null && !lines.length) {
        await tx.delete(focData).where(and(eq(focData.country, country), eq(focData.skuId, cell.skuId), eq(focData.periodId, cell.periodId)));
      } else await tx.insert(focData).values({ country, skuId: cell.skuId, periodId: cell.periodId, value: cell.value === null ? null : String(cell.value),
        received: !!cell.received, lines, receiptDecision: cell.receiptDecision ?? "pending", receiptReviewKey: cell.receiptReviewKey ?? null })
        .onConflictDoUpdate({ target: [focData.country, focData.skuId, focData.periodId],
          set: { value: cell.value === null ? null : String(cell.value), received: !!cell.received, lines, updatedAt: now } });
      const sku = result.original.skus.find(s => s.id === cell.skuId)!;
      const period = result.original.periods.find(p => p.id === cell.periodId)!;
      await tx.insert(auditTrail).values({ country, username: actor, action: "edit_cell", sheet: "FOC",
        skuName: `${sku.name} ${sku.weight} (${sku.packagingType})`, periodLabel: period.label, field: "FOC recorded lines",
        oldValue: JSON.stringify({ value: original?.value ?? null, received: original?.received ?? false, lines: original?.lines ?? [] }),
        newValue: JSON.stringify({ value: cell.value, received: cell.received, lines }),
        details: JSON.stringify({ versionId, includeFoc, impact: result.impact.filter(r => r.skuId === cell.skuId), warnings: warnings.filter(r => r.skuId === cell.skuId),
          note: "Received, duplicate-checked FOC changes arrivals in its own month and carries into every following closing stock. Paid sell-out is unchanged." }) });
    }
    return { success: true as const, versionId, warnings };
  }, { isolationLevel: "serializable" });
}
