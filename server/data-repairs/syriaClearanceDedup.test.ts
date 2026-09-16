import { describe, it, expect, beforeAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Rehearsal of the Syria duplicate-clearance repair against a real database.
// It recreates the exact production rows (same ids, SKUs, batches, quantities
// and dates) inside a transaction, runs the repair, checks the outcome, and
// rolls everything back — so it is side-effect free and can run on every push.
// Skipped when no database is configured.
// ---------------------------------------------------------------------------

import { getDb, getPool } from "../db";
import { clearanceEvents, shipmentData, actualProductionData, forecastData, auditTrail } from "../../drizzle/schema";
import {
  runSyriaClearanceDedup, SYRIA_CLEARANCE_DEDUP_2026_09, REPAIR_ACTOR, REPAIR_LOCK_KEY,
  type RepairDb, type RepairPlan,
} from "./syriaClearanceDedup";

const MAR = 60015, APR = 60016, MAY = 60017, JUN = 60018, AUG = 60020;
const DA50 = 210001, DA250 = 210002, DA1K = 210003, DA50OLD = 150001, GRAPE50 = 150007, GRAPE1K = 150009, MAGIC = 150013, GM1K = 150018, FROSTY = 150019;
const SKUS = [DA50, DA250, DA1K, DA50OLD, GRAPE50, GRAPE1K, MAGIC, GM1K, FROSTY];
const PERIODS = [MAR, APR, MAY, JUN, AUG];

// Exactly what production held on 16 Sept 2026 (id, sku, period, qty, clearedDate)
const PROD_EVENTS: Array<[number, number, number, string, string]> = [
  [12, DA1K, MAR, "1083.00", "2026-05-02"], [13, DA1K, MAR, "3400.00", "2026-05-03"],
  [14, DA250, MAR, "1749.00", "2026-05-03"], [15, DA50, MAR, "3600.00", "2026-05-03"],
  [16, DA50, MAR, "3250.00", "2026-05-18"], [17, DA50OLD, MAR, "6500.00", "2026-05-15"],
  [18, DA50, MAR, "1314.00", "2026-05-21"], [19, DA50OLD, MAR, "1127.00", "2026-05-21"],
  [20, GRAPE1K, MAR, "50.00", "2026-05-25"], [21, MAGIC, MAR, "611.00", "2026-05-21"],
  [22, FROSTY, MAR, "2790.00", "2026-05-21"], [23, DA50, MAR, "3249.00", "2026-05-26"],
  [24, GM1K, MAR, "50.00", "2026-05-21"],
  [45, DA50, AUG, "9000.00", "2026-09-02"], [46, DA1K, AUG, "3650.00", "2026-09-02"], [47, DA250, AUG, "7250.00", "2026-09-02"],
  [48, DA1K, APR, "3400.00", "2026-05-01"], [49, DA1K, APR, "1083.00", "2026-05-04"],
  [50, DA250, APR, "1749.00", "2026-05-04"], [51, DA50, APR, "3600.00", "2026-05-04"],
  [52, DA50OLD, MAY, "6500.00", "2026-05-04"], [53, DA50OLD, MAY, "1127.00", "2026-05-21"],
  [54, GM1K, MAY, "50.00", "2026-05-15"], [55, DA50, MAY, "3250.00", "2026-05-18"],
  [56, DA50, MAY, "1314.00", "2026-05-21"], [57, DA50, MAY, "3249.00", "2026-09-18"],
  [58, FROSTY, MAY, "2790.00", "2026-05-21"], [59, GRAPE50, MAY, "50.00", "2026-09-16"],
  [60, MAGIC, MAY, "611.00", "2026-09-16"],
  [61, DA1K, JUN, "3650.00", "2026-09-16"], [62, DA250, JUN, "7250.00", "2026-09-16"], [63, DA50, JUN, "9000.00", "2026-09-16"],
];
const ALL_IDS = PROD_EVENTS.map(e => e[0]);
const ORIGINALS = [12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 24, 45, 46, 47];
const COPIES = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 60, 61, 62, 63];

// Production (week1) per batch as in production; everything else is 0.
const PRODUCTION: Record<string, number> = {
  [`${DA50}-${APR}`]: 3600, [`${DA250}-${APR}`]: 1750, [`${DA1K}-${APR}`]: 4483,
  [`${DA50OLD}-${MAY}`]: 7627, [`${GRAPE50}-${MAY}`]: 50, [`${MAGIC}-${MAY}`]: 611, [`${GM1K}-${MAY}`]: 50, [`${FROSTY}-${MAY}`]: 2790, [`${DA50}-${MAY}`]: 7814,
  [`${MAGIC}-${JUN}`]: 100, [`${FROSTY}-${JUN}`]: 3200, [`${DA50}-${JUN}`]: 22800, [`${DA250}-${JUN}`]: 8574, [`${DA1K}-${JUN}`]: 14614,
};

class Rollback extends Error {}
const quiet = () => {};

async function seed(tx: RepairDb, events = PROD_EVENTS) {
  await tx.delete(clearanceEvents).where(inArray(clearanceEvents.id, ALL_IDS));
  await tx.insert(clearanceEvents).values(events.map(([id, skuId, periodId, clearedQty, clearedDate]) => ({
    id, skuId, periodId, country: "Syria" as const, clearedQty, clearedDate,
  })));
  await tx.delete(shipmentData).where(and(inArray(shipmentData.skuId, SKUS), inArray(shipmentData.periodId, PERIODS)));
  await tx.insert(shipmentData).values(SKUS.flatMap(skuId => PERIODS.map(periodId => ({
    skuId, periodId,
    week1: String(PRODUCTION[`${skuId}-${periodId}`] ?? 0), week2: "0", week3: "0", week4: "0",
    arrivalStatus: "Pending" as const,
  }))));
  // Production as the app sees it also includes the manual actual and the plan:
  // start every rehearsal batch from zero on both (rolled back afterwards).
  await tx.delete(actualProductionData).where(and(inArray(actualProductionData.skuId, SKUS), inArray(actualProductionData.periodId, PERIODS)));
  await tx.delete(forecastData).where(and(inArray(forecastData.skuId, SKUS), inArray(forecastData.periodId, PERIODS)));
  await tx.delete(auditTrail).where(eq(auditTrail.username, REPAIR_ACTOR));
}

/** Run `body` inside a transaction that is always rolled back. */
async function rehearse(body: (tx: RepairDb) => Promise<void>) {
  const db = await getDb();
  if (!db) throw new Error("no db");
  await db.transaction(async (tx) => {
    await body(tx as unknown as RepairDb);
    throw new Rollback("rollback rehearsal");
  }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
}

const byId = async (tx: RepairDb) => {
  const rows = await tx.select().from(clearanceEvents).where(inArray(clearanceEvents.id, ALL_IDS));
  return new Map(rows.map((r) => [r.id, r]));
};

const ship = async (tx: RepairDb, skuId: number, periodId: number) =>
  (await tx.select().from(shipmentData).where(and(eq(shipmentData.skuId, skuId), eq(shipmentData.periodId, periodId))))[0];

const states = (r: Awaited<ReturnType<typeof runSyriaClearanceDedup>>) =>
  r.steps.reduce((acc, s) => { acc[s.state] = (acc[s.state] ?? 0) + 1; return acc; }, {} as Record<string, number>);

describe.skipIf(!process.env.DATABASE_URL)("Syria clearance dedup repair (rehearsal on a real DB, rolled back)", () => {
  let baselineEvents: number[] = [];
  let baselineAudits: number[] = [];

  beforeAll(async () => {
    const db = (await getDb())!;
    baselineEvents = (await db.select({ id: clearanceEvents.id }).from(clearanceEvents).where(inArray(clearanceEvents.id, ALL_IDS))).map(r => r.id);
    baselineAudits = (await db.select({ id: auditTrail.id }).from(auditTrail).where(eq(auditTrail.username, REPAIR_ACTOR))).map(r => r.id);
  });

  it("re-attaches the 15 originals, drops the 16 duplicates, re-dates Grape 50g, re-syncs batches — and is idempotent", async () => {
    await rehearse(async (tx) => {
      await seed(tx);
      const logs: string[] = [];
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, (m) => logs.push(m));

      expect(report.lockedByOther).toBe(false);
      expect(states(report)).toEqual({ applied: 16 });
      expect(report.moved.sort((a, b) => a - b)).toEqual(ORIGINALS);
      expect(report.deleted.sort((a, b) => a - b)).toEqual([20, ...COPIES]);
      expect(report.redated).toEqual([59]);

      const ev = await byId(tx);
      // 16 events remain: the 15 originals + Grape 50g (#59)
      expect(ev.size).toBe(16);
      expect(ev.get(12)!.periodId).toBe(APR);
      expect(ev.get(12)!.clearedDate).toBe("2026-05-02"); // original date preserved
      expect(ev.get(17)!.periodId).toBe(MAY);
      expect(ev.get(23)!.periodId).toBe(MAY);
      expect(ev.get(23)!.clearedDate).toBe("2026-05-26");
      expect(ev.get(45)!.periodId).toBe(JUN);
      expect(ev.get(59)!.clearedDate).toBe("2026-05-25");
      expect(ev.get(59)!.skuId).toBe(GRAPE50);
      expect(ev.has(20)).toBe(false);
      expect(ev.has(57)).toBe(false);

      // Nothing is left on the empty Mar-26 / Aug-26 batches
      for (const r of ev.values()) expect([MAR, AUG]).not.toContain(r.periodId);

      // Totals now match the arrival schedule: May 28,773 MC, Sept 19,900 MC (48,673 in all, once)
      const sum = (pred: (r: { skuId: number; clearedDate: string }) => boolean) =>
        [...ev.values()].filter(pred).reduce((s, r) => s + Number(r.clearedQty), 0);
      expect(sum(() => true)).toBe(48673);
      expect(sum(r => r.clearedDate.startsWith("2026-05"))).toBe(28773);
      expect(sum(r => r.clearedDate.startsWith("2026-09"))).toBe(19900);
      // Double Apple 50g New: 3,600 + 3,250 + 1,314 + 3,249 = 11,413 in May, 9,000 in Sept
      expect(sum(r => r.skuId === DA50 && r.clearedDate.startsWith("2026-05"))).toBe(11413);
      expect(sum(r => r.skuId === DA50 && r.clearedDate.startsWith("2026-09"))).toBe(9000);

      // Shipment rows re-synced inside the same transaction
      expect((await ship(tx, DA50, MAR)).clearedQty).toBeNull();
      expect(await ship(tx, DA1K, APR)).toMatchObject({ clearedQty: "4483.00", arrivalStatus: "Cleared" });
      expect(await ship(tx, DA50, MAY)).toMatchObject({ clearedQty: "7813.00", arrivalStatus: "Partially Cleared" });
      expect(await ship(tx, DA50, JUN)).toMatchObject({ clearedQty: "9000.00", arrivalStatus: "Partially Cleared" });
      expect(await ship(tx, GRAPE50, MAY)).toMatchObject({ clearedQty: "50.00", arrivalStatus: "Cleared" });
      expect(report.resyncedBatches).toBeGreaterThan(0);

      // Audit trail: one "re-attached" + one "deleted" per pair, plus re-date + delete for Grape
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditTrail).where(eq(auditTrail.username, REPAIR_ACTOR));
      expect(n).toBe(15 * 2 + 2);
      expect(logs.some(l => /Double Apple 50g New: kept event #23/.test(l))).toBe(true);

      // Second run: everything reports "done", nothing changes
      const again = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(states(again)).toEqual({ done: 16 });
      expect(again.moved).toEqual([]);
      expect(again.deleted).toEqual([]);
      expect(again.redated).toEqual([]);
      expect(again.resyncedBatches).toBe(0);
      expect((await byId(tx)).size).toBe(16);
    });
  });

  it("reports an original whose copy is gone as inconsistent and leaves it alone", async () => {
    await rehearse(async (tx) => {
      await seed(tx, PROD_EVENTS.filter(e => e[0] !== 49)); // copy of #12 already deleted by hand
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);

      expect(states(report)).toEqual({ applied: 15, inconsistent: 1 });
      const bad = report.steps.find(s => s.state === "inconsistent")!;
      expect(bad.id).toBe(12);
      expect(bad.detail).toMatch(/copy: missing/);
      expect(report.moved).not.toContain(12);
      const ev = await byId(tx);
      expect(ev.get(12)).toMatchObject({ periodId: MAR, clearedQty: "1083.00" }); // still there, still on Mar-26
      expect(ev.size).toBe(16); // 31 seeded − 15 deleted
    });
  });

  it("treats a copy left alone on the right batch (original deleted by hand) as done", async () => {
    await rehearse(async (tx) => {
      await seed(tx, PROD_EVENTS.filter(e => e[0] !== 12)); // user deleted the original instead
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(states(report)).toEqual({ applied: 15, done: 1 });
      expect(report.steps.find(s => s.id === 12)).toMatchObject({ state: "done" });
      expect((await byId(tx)).get(49)).toMatchObject({ periodId: APR, clearedQty: "1083.00" });
    });
  });

  it("refuses to touch a pair whose original batch has production again", async () => {
    await rehearse(async (tx) => {
      await seed(tx);
      await tx.update(shipmentData).set({ week1: "1083" })
        .where(and(eq(shipmentData.skuId, DA1K), eq(shipmentData.periodId, MAR)));
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);

      expect(states(report)).toEqual({ applied: 14, inconsistent: 2 });
      expect(report.steps.filter(s => s.state === "inconsistent").map(s => s.id)).toEqual([12, 13]);
      const ev = await byId(tx);
      expect(ev.has(48)).toBe(true);
      expect(ev.has(49)).toBe(true);
      expect(ev.get(12)!.periodId).toBe(MAR);
    });
  });

  it("also counts a manual actual or a forecast plan on the original batch as production", async () => {
    await rehearse(async (tx) => {
      await seed(tx);
      await tx.insert(actualProductionData).values({ skuId: DA250, periodId: MAR, value: "5" });
      await tx.insert(forecastData).values({ skuId: DA50, periodId: AUG, value: "9000" });
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);

      expect(states(report)).toEqual({ applied: 14, inconsistent: 2 });
      expect(report.steps.filter(s => s.state === "inconsistent").map(s => s.id)).toEqual([14, 45]);
      const ev = await byId(tx);
      expect(ev.get(14)).toMatchObject({ periodId: MAR });
      expect(ev.has(50)).toBe(true);
      expect(ev.get(45)).toMatchObject({ periodId: AUG });
      expect(ev.has(63)).toBe(true);
    });
  });

  it("does not touch a row whose recorded quantity or date differs", async () => {
    await rehearse(async (tx) => {
      const edited = PROD_EVENTS.map(e => e[0] === 63 ? [63, DA50, JUN, "9000.00", "2026-09-20"] as typeof e : e); // user changed the copy's date
      await seed(tx, edited);
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(report.steps.find(s => s.id === 45)).toMatchObject({ state: "inconsistent" });
      const ev = await byId(tx);
      expect(ev.get(45)).toMatchObject({ periodId: AUG });
      expect(ev.get(63)).toMatchObject({ clearedDate: "2026-09-20" });
    });
  });

  it("Grape: never re-dates #59 unless #20 is present exactly as recorded, and never deletes #20 unless #59 has the wrong date", async () => {
    // #20 already deleted by hand → #59 keeps its date, step is reported, nothing written
    await rehearse(async (tx) => {
      await seed(tx, PROD_EVENTS.filter(e => e[0] !== 20));
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(report.steps.find(s => s.id === 59)).toMatchObject({ state: "inconsistent" });
      expect(report.redated).toEqual([]);
      expect((await byId(tx)).get(59)!.clearedDate).toBe("2026-09-16");
    });
    // #59 already re-dated by hand but #20 still there → #20 is NOT deleted (state is not the recorded one)
    await rehearse(async (tx) => {
      const edited = PROD_EVENTS.map(e => e[0] === 59 ? [59, GRAPE50, MAY, "50.00", "2026-05-25"] as typeof e : e);
      await seed(tx, edited);
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(report.steps.find(s => s.id === 59)).toMatchObject({ state: "inconsistent" });
      expect(report.deleted).not.toContain(20);
      expect((await byId(tx)).has(20)).toBe(true);
    });
    // fully applied end state → done
    await rehearse(async (tx) => {
      const edited = PROD_EVENTS.filter(e => e[0] !== 20).map(e => e[0] === 59 ? [59, GRAPE50, MAY, "50.00", "2026-05-25"] as typeof e : e);
      await seed(tx, edited);
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(report.steps.find(s => s.id === 59)).toMatchObject({ state: "done" });
    });
  });

  it("reports every step as absent in a database that never had these events", async () => {
    await rehearse(async (tx) => {
      await tx.delete(clearanceEvents).where(inArray(clearanceEvents.id, ALL_IDS));
      const report = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(states(report)).toEqual({ absent: 16 });
      expect(report.moved).toEqual([]);
      expect(report.deleted).toEqual([]);
    });
  });

  it("is all-or-nothing: a failure part-way through rolls every change back", async () => {
    await rehearse(async (tx) => {
      await seed(tx);
      let calls = 0;
      const failing = () => { if (++calls === 5) throw new Error("boom"); };
      await expect(runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, failing)).rejects.toThrow("boom");

      const ev = await byId(tx);
      expect(ev.size).toBe(32);
      for (const id of ORIGINALS) expect([MAR, AUG]).toContain(ev.get(id)!.periodId);
      expect(ev.get(59)!.clearedDate).toBe("2026-09-16");
      expect((await ship(tx, DA1K, APR)).clearedQty).toBeNull();
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(auditTrail).where(eq(auditTrail.username, REPAIR_ACTOR));
      expect(n).toBe(0);

      // …and a clean retry afterwards applies everything
      const retry = await runSyriaClearanceDedup(tx, SYRIA_CLEARANCE_DEDUP_2026_09, quiet);
      expect(states(retry)).toEqual({ applied: 16 });
    });
  });

  it("skips the whole run without touching anything when another instance holds the repair lock", async () => {
    const pool = (await getPool())!;
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query("SELECT pg_advisory_xact_lock($1)", [REPAIR_LOCK_KEY]);

      const db = (await getDb())! as unknown as RepairDb;
      const plan: RepairPlan = { pairs: [], skuSwaps: [] };
      const report = await runSyriaClearanceDedup(db, plan, quiet);
      expect(report.lockedByOther).toBe(true);
      expect(report.steps).toEqual([]);
    } finally {
      await other.query("ROLLBACK");
      other.release();
    }
  });

  it("does not leave any rehearsal rows behind", async () => {
    const db = (await getDb())!;
    const rows = (await db.select({ id: clearanceEvents.id }).from(clearanceEvents).where(inArray(clearanceEvents.id, ALL_IDS))).map(r => r.id);
    expect(rows.sort()).toEqual([...baselineEvents].sort());
    const audits = (await db.select({ id: auditTrail.id }).from(auditTrail).where(eq(auditTrail.username, REPAIR_ACTOR))).map(r => r.id);
    expect(audits.sort()).toEqual([...baselineAudits].sort());
  });
});
