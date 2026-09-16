// ── One-off data repair: Syria duplicate clearance events (Sept 2026) ────────
//
// What happened: clearance events for Syria's Apr/May/Jun-2026 production were
// logged (May–Sept 2026) against the Mar-26 and Aug-26 production batches. On
// 16 Sept 2026 a Forecast Import re-synced the Production table and moved that
// production to Apr/May/Jun-26. The events stayed attached to the now-empty
// Mar-26 / Aug-26 batches, disappeared from the Arrival page, and the arrivals
// were re-entered under the correct batches — so Planning FG counted every
// arrival twice (48,673 MC).
//
// What this does, in ONE transaction (all or nothing):
//   • For each original event that has an exact re-entered copy (same SKU and
//     quantity), the ORIGINAL is kept — it carries the cleared date entered at
//     the time — and is re-attached to the production batch the copy points at;
//     the copy is deleted.
//   • Grape 50 MC (May 2026): the original was logged on Grape 1kg, the copy on
//     Grape 50g. Production and the arrival schedule both say Grape 50g, so the
//     copy is kept, given the original cleared date, and the original deleted.
//   • Shipment rows of every touched batch are re-synced (cleared qty/status)
//     inside the same transaction.
//   • Every change is written to the audit trail.
//
// Safety:
//   • Every row must look EXACTLY as recorded below (id, country, SKU, batch,
//     quantity, cleared date) and the original's batch must have no production
//     at all, otherwise that step is left alone and reported.
//   • Once applied — or if the user already cleaned a pair up by hand so that a
//     single event remains on the right batch — the step reports "done" and
//     nothing is written. Any other leftover state is reported as inconsistent
//     for a human to look at; it is never "fixed" by guessing.
//   • A non-blocking advisory lock makes concurrent instances (autoscale) skip
//     the run instead of queueing; lock/statement timeouts bound how long a
//     boot can wait on someone else's open transaction. A failure rolls the
//     whole transaction back, so a later start simply picks it up again.

import { and, eq, sql } from "drizzle-orm";
import { clearanceEvents, shipmentData, actualProductionData, forecastData, auditTrail, skus, periods } from "../../drizzle/schema";
import { syncShipmentClearedFromEventsWith, type DbExecutor } from "../db";

export const REPAIR_COUNTRY = "Syria" as const;
export const REPAIR_ACTOR = "system:data-repair";
/** Advisory lock key shared by all instances running this repair. */
export const REPAIR_LOCK_KEY = 20260916;

export interface DuplicatePair {
  /** Original event (kept, re-attached). */
  keepId: number;
  keepDate: string;
  /** Re-entered copy (deleted). */
  dropId: number;
  dropDate: string;
  skuId: number;
  /** Batch the original is currently attached to (must have zero production). */
  fromPeriodId: number;
  /** Batch the copy points at — the correct production month. */
  toPeriodId: number;
  /** Exact cleared quantity both rows must carry. */
  qty: string;
}

export interface SkuSwapFix {
  /** Event kept (correct SKU/batch) whose cleared date is corrected. */
  keepId: number;
  keepSkuId: number;
  keepPeriodId: number;
  /** Date the kept event currently has (wrong) and the one it should have. */
  wrongDate: string;
  rightDate: string;
  /** Event deleted (same arrival logged on the wrong SKU / empty batch). */
  dropId: number;
  dropSkuId: number;
  dropPeriodId: number;
  dropDate: string;
  qty: string;
}

export interface RepairPlan {
  pairs: DuplicatePair[];
  skuSwaps: SkuSwapFix[];
}

// Period ids: 60015 = Mar 26, 60016 = Apr 26, 60017 = May 26, 60018 = Jun 26,
// 60020 = Aug 26 (Syria). SKU ids: 210001 DA 50g New, 210002 DA 250g New,
// 210003 DA 1kg New, 150001 DA 50g Old, 150007 Grape 50g, 150009 Grape 1kg,
// 150013 Magic Love 50g, 150018 Grape & Mint 1kg, 150019 DA Frosty 50g.
export const SYRIA_CLEARANCE_DEDUP_2026_09: RepairPlan = {
  pairs: [
    // Mar-26 → Apr-26
    { keepId: 12, keepDate: "2026-05-02", dropId: 49, dropDate: "2026-05-04", skuId: 210003, fromPeriodId: 60015, toPeriodId: 60016, qty: "1083.00" },
    { keepId: 13, keepDate: "2026-05-03", dropId: 48, dropDate: "2026-05-01", skuId: 210003, fromPeriodId: 60015, toPeriodId: 60016, qty: "3400.00" },
    { keepId: 14, keepDate: "2026-05-03", dropId: 50, dropDate: "2026-05-04", skuId: 210002, fromPeriodId: 60015, toPeriodId: 60016, qty: "1749.00" },
    { keepId: 15, keepDate: "2026-05-03", dropId: 51, dropDate: "2026-05-04", skuId: 210001, fromPeriodId: 60015, toPeriodId: 60016, qty: "3600.00" },
    // Mar-26 → May-26
    { keepId: 16, keepDate: "2026-05-18", dropId: 55, dropDate: "2026-05-18", skuId: 210001, fromPeriodId: 60015, toPeriodId: 60017, qty: "3250.00" },
    { keepId: 17, keepDate: "2026-05-15", dropId: 52, dropDate: "2026-05-04", skuId: 150001, fromPeriodId: 60015, toPeriodId: 60017, qty: "6500.00" },
    { keepId: 18, keepDate: "2026-05-21", dropId: 56, dropDate: "2026-05-21", skuId: 210001, fromPeriodId: 60015, toPeriodId: 60017, qty: "1314.00" },
    { keepId: 19, keepDate: "2026-05-21", dropId: 53, dropDate: "2026-05-21", skuId: 150001, fromPeriodId: 60015, toPeriodId: 60017, qty: "1127.00" },
    { keepId: 21, keepDate: "2026-05-21", dropId: 60, dropDate: "2026-09-16", skuId: 150013, fromPeriodId: 60015, toPeriodId: 60017, qty: "611.00" },
    { keepId: 22, keepDate: "2026-05-21", dropId: 58, dropDate: "2026-05-21", skuId: 150019, fromPeriodId: 60015, toPeriodId: 60017, qty: "2790.00" },
    { keepId: 23, keepDate: "2026-05-26", dropId: 57, dropDate: "2026-09-18", skuId: 210001, fromPeriodId: 60015, toPeriodId: 60017, qty: "3249.00" },
    { keepId: 24, keepDate: "2026-05-21", dropId: 54, dropDate: "2026-05-15", skuId: 150018, fromPeriodId: 60015, toPeriodId: 60017, qty: "50.00" },
    // Aug-26 → Jun-26 (September clearances of June production)
    { keepId: 45, keepDate: "2026-09-02", dropId: 63, dropDate: "2026-09-16", skuId: 210001, fromPeriodId: 60020, toPeriodId: 60018, qty: "9000.00" },
    { keepId: 46, keepDate: "2026-09-02", dropId: 61, dropDate: "2026-09-16", skuId: 210003, fromPeriodId: 60020, toPeriodId: 60018, qty: "3650.00" },
    { keepId: 47, keepDate: "2026-09-02", dropId: 62, dropDate: "2026-09-16", skuId: 210002, fromPeriodId: 60020, toPeriodId: 60018, qty: "7250.00" },
  ],
  skuSwaps: [
    // Grape 50 MC cleared 25 May 2026: keep the Grape 50g copy (#59), give it
    // the original date, drop the Grape 1kg original (#20) on the empty Mar-26.
    {
      keepId: 59, keepSkuId: 150007, keepPeriodId: 60017, wrongDate: "2026-09-16", rightDate: "2026-05-25",
      dropId: 20, dropSkuId: 150009, dropPeriodId: 60015, dropDate: "2026-05-25", qty: "50.00",
    },
  ],
};

/**
 *  applied      – changed in this run
 *  done         – already in a good end state, nothing written
 *  absent       – neither event exists in this database (e.g. dev / a fork
 *                 that never had the incident), nothing to repair
 *  inconsistent – something is there but not as recorded; left alone, reported
 */
export type StepState = "applied" | "done" | "absent" | "inconsistent";

export interface StepResult {
  /** Id of the event that is kept for this step. */
  id: number;
  state: StepState;
  detail: string;
}

export interface RepairReport {
  /** True when another instance held the repair lock — nothing was checked or changed. */
  lockedByOther: boolean;
  moved: number[];
  deleted: number[];
  redated: number[];
  steps: StepResult[];
  resyncedBatches: number;
}

export type RepairDb = DbExecutor & {
  execute: (query: ReturnType<typeof sql>) => Promise<any>;
  transaction<T>(fn: (tx: RepairDb) => Promise<T>): Promise<T>;
};

const sameQty = (a: string | null | undefined, b: string) => a != null && Number(a) === Number(b);

type EventRow = typeof clearanceEvents.$inferSelect;

/** Fetch one Syria event by id, locked for update (undefined when it does not exist). */
async function lockEvent(tx: RepairDb, id: number): Promise<EventRow | undefined> {
  const rows = await tx.select().from(clearanceEvents)
    .where(and(eq(clearanceEvents.id, id), eq(clearanceEvents.country, REPAIR_COUNTRY)))
    .for("update");
  return rows[0];
}

/** True when the row exists and matches every recorded attribute. */
function matches(row: EventRow | undefined, skuId: number, periodId: number, qty: string, date: string): row is EventRow {
  return !!row && row.skuId === skuId && row.periodId === periodId && sameQty(row.clearedQty, qty) && row.clearedDate === date;
}

/**
 * Everything the app counts as production for a batch — weekly entries, the
 * manual "actual", and the forecast plan (the Arrival page's orphan rule treats
 * a planned batch as a real one). Rows are locked so a concurrent edit cannot
 * slip in between this check and the commit.
 */
async function productionOf(db: RepairDb, skuId: number, periodId: number): Promise<number> {
  let total = 0;
  const rows = await db.select().from(shipmentData)
    .where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId)))
    .for("update");
  for (const r of rows) {
    for (const w of [r.week1, r.week2, r.week3, r.week4]) total += Number(w ?? 0) || 0;
  }
  const actual = await db.select().from(actualProductionData)
    .where(and(eq(actualProductionData.skuId, skuId), eq(actualProductionData.periodId, periodId)))
    .for("update");
  for (const a of actual) total += Number(a.value ?? 0) || 0;
  const planned = await db.select().from(forecastData)
    .where(and(eq(forecastData.skuId, skuId), eq(forecastData.periodId, periodId)))
    .for("update");
  for (const f of planned) total += Number(f.value ?? 0) || 0;
  return total;
}

async function labelsFor(db: RepairDb, skuId: number, periodId: number) {
  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  const [period] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
  const skuName = sku ? `${sku.name} ${sku.weight} ${sku.packagingType ?? ""}`.trim() : `SKU ${skuId}`;
  return { skuName, periodLabel: period?.label ?? `period ${periodId}` };
}

async function audit(db: RepairDb, entry: { skuName: string; periodLabel: string; field: string; oldValue: string; newValue: string; details: string }) {
  await db.insert(auditTrail).values({
    country: REPAIR_COUNTRY,
    username: REPAIR_ACTOR,
    action: "edit",
    sheet: "Arrival",
    ...entry,
  });
}

function describe(row: EventRow | undefined): string {
  if (!row) return "missing";
  return `sku ${row.skuId}, batch ${row.periodId}, ${row.clearedQty} MC, cleared ${row.clearedDate}`;
}

export async function runSyriaClearanceDedup(
  db: RepairDb,
  plan: RepairPlan = SYRIA_CLEARANCE_DEDUP_2026_09,
  log: (msg: string) => void = (m) => console.log(m),
): Promise<RepairReport> {
  const report: RepairReport = { lockedByOther: false, moved: [], deleted: [], redated: [], steps: [], resyncedBatches: 0 };

  await db.transaction(async (tx) => {
    // Never queue behind another instance or an open user transaction.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
    const lock: any = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${REPAIR_LOCK_KEY}) AS ok`);
    const lockRows = lock?.rows ?? lock;
    if (!lockRows?.[0]?.ok) {
      report.lockedByOther = true;
      return;
    }

    const touched = new Map<string, { skuId: number; periodId: number }>();
    const touch = (skuId: number, periodId: number) => touched.set(`${skuId}-${periodId}`, { skuId, periodId });

    for (const pair of plan.pairs) {
      const keep = await lockEvent(tx, pair.keepId);
      const drop = await lockEvent(tx, pair.dropId);
      const keepAsRecorded = matches(keep, pair.skuId, pair.fromPeriodId, pair.qty, pair.keepDate);
      const dropAsRecorded = matches(drop, pair.skuId, pair.toPeriodId, pair.qty, pair.dropDate);

      if (keepAsRecorded && dropAsRecorded) {
        const prod = await productionOf(tx, pair.skuId, pair.fromPeriodId);
        if (prod !== 0) {
          report.steps.push({ id: pair.keepId, state: "inconsistent", detail: `batch ${pair.fromPeriodId} has production (${prod}); left both events alone` });
          continue;
        }
        const from = await labelsFor(tx, pair.skuId, pair.fromPeriodId);
        const to = await labelsFor(tx, pair.skuId, pair.toPeriodId);

        await tx.update(clearanceEvents)
          .set({ periodId: pair.toPeriodId, updatedAt: sql`now()` })
          .where(eq(clearanceEvents.id, pair.keepId));
        await tx.delete(clearanceEvents).where(eq(clearanceEvents.id, pair.dropId));

        await audit(tx, {
          skuName: from.skuName, periodLabel: to.periodLabel, field: "clearance_event.period",
          oldValue: from.periodLabel, newValue: to.periodLabel,
          details: `Clearance event ${pair.keepId} (${pair.qty} MC, cleared ${keep.clearedDate}) re-attached from ${from.periodLabel} (no production) to ${to.periodLabel}`,
        });
        await audit(tx, {
          skuName: from.skuName, periodLabel: to.periodLabel, field: "clearance_event",
          oldValue: `${pair.qty} MC cleared ${drop.clearedDate}`, newValue: "",
          details: `Clearance event ${pair.dropId} deleted — duplicate of event ${pair.keepId}`,
        });

        report.moved.push(pair.keepId);
        report.deleted.push(pair.dropId);
        report.steps.push({ id: pair.keepId, state: "applied", detail: `re-attached to ${to.periodLabel}; duplicate #${pair.dropId} deleted` });
        touch(pair.skuId, pair.fromPeriodId);
        touch(pair.skuId, pair.toPeriodId);
        log(`[DataRepair] ${from.skuName}: kept event #${pair.keepId} (${pair.qty} MC) → ${to.periodLabel}; deleted duplicate #${pair.dropId}`);
        continue;
      }

      // Already in a good end state? Exactly one event with this quantity on
      // the correct batch — either the original after this repair ran, or the
      // copy alone because the user deleted the original by hand.
      const keepMoved = matches(keep, pair.skuId, pair.toPeriodId, pair.qty, pair.keepDate) && !drop;
      const copyAlone = !keep && !!drop && drop.skuId === pair.skuId && drop.periodId === pair.toPeriodId && sameQty(drop.clearedQty, pair.qty);
      if (keepMoved || copyAlone) {
        report.steps.push({ id: pair.keepId, state: "done", detail: keepMoved ? "already re-attached" : `original gone, copy #${pair.dropId} remains` });
        continue;
      }
      if (!keep && !drop) {
        report.steps.push({ id: pair.keepId, state: "absent", detail: `neither #${pair.keepId} nor #${pair.dropId} exists here` });
        continue;
      }
      report.steps.push({
        id: pair.keepId, state: "inconsistent",
        detail: `expected original #${pair.keepId} (${pair.qty} MC on ${pair.fromPeriodId}, ${pair.keepDate}) + copy #${pair.dropId} (on ${pair.toPeriodId}, ${pair.dropDate}); found original: ${describe(keep)}; copy: ${describe(drop)}`,
      });
    }

    for (const fix of plan.skuSwaps) {
      const keep = await lockEvent(tx, fix.keepId);
      const drop = await lockEvent(tx, fix.dropId);
      const keepWrong = matches(keep, fix.keepSkuId, fix.keepPeriodId, fix.qty, fix.wrongDate);
      const keepRight = matches(keep, fix.keepSkuId, fix.keepPeriodId, fix.qty, fix.rightDate);
      const dropAsRecorded = matches(drop, fix.dropSkuId, fix.dropPeriodId, fix.qty, fix.dropDate);

      if (keepWrong && dropAsRecorded) {
        const prod = await productionOf(tx, fix.dropSkuId, fix.dropPeriodId);
        if (prod !== 0) {
          report.steps.push({ id: fix.keepId, state: "inconsistent", detail: `batch ${fix.dropPeriodId} has production (${prod}); left both events alone` });
          continue;
        }
        const keepLabels = await labelsFor(tx, fix.keepSkuId, fix.keepPeriodId);
        const dropLabels = await labelsFor(tx, fix.dropSkuId, fix.dropPeriodId);

        await tx.update(clearanceEvents)
          .set({ clearedDate: fix.rightDate, updatedAt: sql`now()` })
          .where(eq(clearanceEvents.id, fix.keepId));
        await tx.delete(clearanceEvents).where(eq(clearanceEvents.id, fix.dropId));

        await audit(tx, {
          skuName: keepLabels.skuName, periodLabel: keepLabels.periodLabel, field: "clearance_event.clearedDate",
          oldValue: fix.wrongDate, newValue: fix.rightDate,
          details: `Clearance event ${fix.keepId} (${fix.qty} MC) cleared date corrected to the date of original event ${fix.dropId}`,
        });
        await audit(tx, {
          skuName: dropLabels.skuName, periodLabel: dropLabels.periodLabel, field: "clearance_event",
          oldValue: `${fix.qty} MC cleared ${drop.clearedDate}`, newValue: "",
          details: `Clearance event ${fix.dropId} deleted — same arrival is event ${fix.keepId} on ${keepLabels.skuName}`,
        });

        report.redated.push(fix.keepId);
        report.deleted.push(fix.dropId);
        report.steps.push({ id: fix.keepId, state: "applied", detail: `cleared date ${fix.wrongDate} → ${fix.rightDate}; #${fix.dropId} on ${dropLabels.skuName} deleted` });
        touch(fix.keepSkuId, fix.keepPeriodId);
        touch(fix.dropSkuId, fix.dropPeriodId);
        log(`[DataRepair] ${keepLabels.skuName}: event #${fix.keepId} cleared date ${fix.wrongDate} → ${fix.rightDate}; deleted #${fix.dropId} (${fix.qty} MC on empty ${dropLabels.periodLabel}, ${dropLabels.skuName})`);
        continue;
      }

      if (keepRight && !drop) {
        report.steps.push({ id: fix.keepId, state: "done", detail: "already corrected" });
        continue;
      }
      if (!keep && !drop) {
        report.steps.push({ id: fix.keepId, state: "absent", detail: `neither #${fix.keepId} nor #${fix.dropId} exists here` });
        continue;
      }
      report.steps.push({
        id: fix.keepId, state: "inconsistent",
        detail: `expected #${fix.keepId} (sku ${fix.keepSkuId}, ${fix.qty} MC, ${fix.wrongDate}) + #${fix.dropId} (sku ${fix.dropSkuId}, ${fix.dropDate}); found kept: ${describe(keep)}; duplicate: ${describe(drop)}`,
      });
    }

    for (const { skuId, periodId } of touched.values()) {
      await syncShipmentClearedFromEventsWith(tx, skuId, periodId, REPAIR_COUNTRY);
      report.resyncedBatches += 1;
    }
  });

  if (report.moved.length || report.deleted.length || report.redated.length) {
    log(`[DataRepair] Syria clearance dedup: ${report.moved.length} re-attached, ${report.deleted.length} deleted, ${report.redated.length} re-dated, ${report.resyncedBatches} batches re-synced`);
  }
  return report;
}
