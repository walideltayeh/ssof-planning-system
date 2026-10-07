import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { skus, periods, focData, arrivalData, planningFgData, clearanceEvents, auditTrail } from "../drizzle/schema";
import { supportsFoc, type FocCountry } from "../shared/performance/foc";
import { evaluateFocReceipts } from "../shared/performance/focReceipts";

async function database() {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  return db;
}
type Db = Awaited<ReturnType<typeof database>>;
export type ReceiptChange = { skuId?: number; periodId?: number; received: boolean };
function fail(message: string): never { throw new TRPCError({ code: "BAD_REQUEST", message }); }

export async function loadFocReceiptData(country: FocCountry, connection?: Db) {
  if (!supportsFoc(country)) fail("FOC is available only for Libya and Syria");
  const db = connection ?? await database();
  const [ss, ps, foc, arrival, planning, clearances] = await Promise.all([
    db.select().from(skus).where(and(eq(skus.country, country), eq(skus.isActive, true))).orderBy(skus.sortOrder),
    db.select().from(periods).where(eq(periods.country, country)).orderBy(periods.sortOrder),
    db.select().from(focData).where(eq(focData.country, country)),
    db.select({ row: arrivalData }).from(arrivalData).innerJoin(skus, eq(skus.id, arrivalData.skuId)).where(eq(skus.country, country)),
    db.select({ row: planningFgData }).from(planningFgData).innerJoin(skus, eq(skus.id, planningFgData.skuId)).where(eq(skus.country, country)),
    db.select().from(clearanceEvents).where(eq(clearanceEvents.country, country)),
  ]);
  return { country, skus: ss, periods: ps, foc, arrival: arrival.map(r => r.row),
    planningFg: planning.map(r => r.row), clearanceEvents: clearances };
}

function validateScope(ds: Awaited<ReturnType<typeof loadFocReceiptData>>, input: ReceiptChange) {
  if (!input.skuId && !input.periodId) fail("Choose a SKU row or a month");
  if (input.skuId && !ds.skus.some(s => s.id === input.skuId)) fail("SKU is not active in this country");
  if (input.periodId && !ds.periods.some(p => p.id === input.periodId)) fail("Month does not belong to this country");
}

async function preview(country: FocCountry, input: ReceiptChange, db?: Db) {
  const ds = await loadFocReceiptData(country, db);
  validateScope(ds, input);
  const scoped = ds.foc.filter(c => (!input.skuId || c.skuId === input.skuId) && (!input.periodId || c.periodId === input.periodId)
    && ds.skus.some(s => s.id === c.skuId) && ds.periods.some(p => p.id === c.periodId));
  const candidates = scoped.filter(c => c.value !== null && c.received !== input.received);
  const next = { ...ds, foc: ds.foc.map(c => candidates.includes(c) ? { ...c, received: input.received } : c) };
  const evaluated = evaluateFocReceipts(next);
  const changes = candidates.map(c => ({
    ...evaluated.find(e => e.skuId === c.skuId && e.periodId === c.periodId)!,
    before: { received: c.received },
    after: { received: input.received },
  }));
  const canonicalScope = { skuId: input.skuId, periodId: input.periodId, received: input.received };
  const token = createHash("sha256").update(JSON.stringify({ input: canonicalScope, changes, cells: scoped })).digest("hex");
  const expected = ds.skus.filter(s => !input.skuId || s.id === input.skuId).length *
    ds.periods.filter(p => !input.periodId || p.id === input.periodId).length;
  return { token, changes, skippedNotSet: expected - scoped.filter(c => c.value !== null).length };
}
export async function previewFocReceipts(country: FocCountry, input: ReceiptChange) { return preview(country, input); }

async function applyChanges(country: FocCountry, actor: string, input: ReceiptChange, token?: string) {
  const db = await database();
  return db.transaction(async tx => {
    // Serialize FOC edits, bulk actions and PO imports for this country's SKUs.
    await tx.select().from(skus).where(eq(skus.country, country)).for("update");
    const result = await preview(country, input, tx as unknown as Db);
    if (token && token !== result.token) throw new TRPCError({ code: "CONFLICT", message: "FOC or arrivals changed since preview. Review the confirmation again." });
    if (input.skuId && input.periodId) {
      const [cell] = await tx.select().from(focData).where(and(eq(focData.country, country), eq(focData.skuId, input.skuId), eq(focData.periodId, input.periodId)));
      if (!cell || cell.value === null) fail("Enter an FOC quantity before changing its receipt");
    }
    for (const c of result.changes) {
      await tx.update(focData).set({ received: c.after.received,
        updatedAt: new Date() })
        .where(and(eq(focData.country, country), eq(focData.skuId, c.skuId), eq(focData.periodId, c.periodId)));
      await tx.insert(auditTrail).values({ country, username: actor, action: "edit_cell", sheet: "FOC",
        skuName: c.sku, periodLabel: c.planMonth, field: "FOC receipt",
        oldValue: JSON.stringify(c.before), newValue: JSON.stringify(c.after),
        details: JSON.stringify({ receiptMonth: c.receiptMonth, quantityMC: c.quantity, duplicateMatches: c.matches,
          withheldPendingReview: c.needsReview, bulk: !input.skuId || !input.periodId }) });
    }
    return { success: true, changed: result.changes.length, warnings: result.changes.filter(c => c.needsReview) };
  });
}
export async function updateFocReceipt(country: FocCountry, actor: string, input: { skuId: number; periodId: number; received: boolean }) {
  return applyChanges(country, actor, input);
}
export async function commitFocReceipts(country: FocCountry, actor: string, input: ReceiptChange, token: string) {
  return applyChanges(country, actor, input, token);
}
export async function reviewFocReceipt(country: FocCountry, actor: string,
  input: { skuId: number; periodId: number; decision: "separate" | "included"; reviewKey: string }) {
  const db = await database();
  return db.transaction(async tx => {
    await tx.select().from(skus).where(eq(skus.country, country)).for("update");
    const ds = await loadFocReceiptData(country, tx as unknown as Db);
    const entry = evaluateFocReceipts(ds).find(e => e.skuId === input.skuId && e.periodId === input.periodId);
    if (!entry?.received || (!entry.matches.length && !entry.needsReview) || !entry.receiptPeriodId) fail("No received FOC duplicate warning to review");
    if (entry.reviewKey !== input.reviewKey) throw new TRPCError({ code: "CONFLICT", message: "Arrival evidence changed. Reload and review the warning again." });
    const old = ds.foc.find(c => c.skuId === input.skuId && c.periodId === input.periodId)!;
    // Only stock-counted sources support "already included"; weekly recorded
    // arrivals in international countries are not the authoritative stock ledger.
    if (input.decision === "included" && !entry.matches.some(m => m.source.includes("clearance") || m.source === "Clearance arrival"))
      fail("No matching stock-counted clearance arrival exists. Review the recorded arrival before resolving this as already counted.");
    await tx.update(focData).set({ receiptDecision: input.decision, receiptReviewKey: entry.reviewKey, updatedAt: new Date() })
      .where(and(eq(focData.country, country), eq(focData.skuId, entry.skuId), eq(focData.periodId, entry.periodId)));
    await tx.insert(auditTrail).values({ country, username: actor, action: "edit_cell", sheet: "FOC",
      skuName: entry.sku, periodLabel: entry.planMonth, field: "FOC duplicate receipt review",
      oldValue: old.receiptDecision, newValue: input.decision,
      details: JSON.stringify({ quantityMC: entry.quantity, receiptMonth: entry.receiptMonth, matches: entry.matches,
        explanation: input.decision === "included" ? "Already counted in recorded arrival; no additional FOC stock" : "Admin confirmed a separate shipment; add FOC to arrivals" }) });
    return { success: true };
  });
}
