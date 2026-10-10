import { getPool } from "./db";
import { isTrackerClearance, trackerBusinessDate, type SyncPlan } from "./wsTracker";
import { fgProductionMap } from "../shared/arrivalQuantities";

type Ims = { skuId: number; periodId: number; value: string; isActual: boolean };
type Arrival = { skuId: number; periodId: number; week1: string; week2: string; week3: string; week4: string };
type Event = { id: number; skuId: number; periodId: number; country: string; clearedQty: string;
  clearedDate: string | Date | null; notes: string | null; containerRef: string | null };

/** One transaction: no partial IMS update followed by failed clearance rebuild.
 * Ownership is the existing reserved WST + WS Tracker marker, never country alone.
 * Keeps a before-image in the audit trail for future lost-data investigations.
 */
export async function persistTrackerSync(plan: SyncPlan, ims: Ims[], arrivals: Arrival[], actor: string) {
  const pool = await getPool();
  if (!pool) throw new Error("Database unavailable; tracker sync was not applied");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(510021)");
    const ids = plan.managedSkuIds ?? [...new Set([...plan.rows, ...plan.clearance.events].map(r => r.skuId))];
    const skuScope = await client.query('SELECT id FROM skus WHERE country = $1 AND id = ANY($2::int[])', ["Syria", ids]);
    if (skuScope.rows.length !== ids.length) throw new Error("Tracker sync contains a SKU outside Syria");
    const periodScope = await client.query('SELECT id,year,month FROM periods WHERE country = $1', ["Syria"]);
    const periodIds = new Set(periodScope.rows.map(r => r.id));
    const months = new Set(periodScope.rows.map(r => `${r.year}-${String(r.month).padStart(2, "0")}`));
    if ([...ims, ...arrivals, ...plan.clearance.events].some(r => !ids.includes(r.skuId) || !periodIds.has(r.periodId)))
      throw new Error("Tracker sync contains a cell outside Syria");
    if (plan.clearance.events.some(e => !months.has(e.date.slice(0, 7))))
      throw new Error("Tracker delivery month has no Syria period");
    const existing = await client.query<Event>('SELECT * FROM clearance_events WHERE country = $1 FOR UPDATE', ["Syria"]);
    const owned = existing.rows.filter(e => isTrackerClearance(e) && ids.includes(e.skuId)
      && trackerBusinessDate(e.clearedDate).slice(0, 7) >= plan.feed.from
      && trackerBusinessDate(e.clearedDate).slice(0, 7) <= plan.feed.to);
    const conflicts = existing.rows.filter(e => !isTrackerClearance(e) && Number(e.clearedQty) > 0
      && plan.clearance.events.some(n => n.skuId === e.skuId && n.date === trackerBusinessDate(e.clearedDate)));
    if (conflicts.length) throw new Error("Sync blocked: non-tracker clearances overlap tracker delivery dates. No data was changed.");
    const beforeIms = await client.query('SELECT * FROM ims_data WHERE "skuId" = ANY($1::int[])', [ids]);
    const beforeArrivals = await client.query('SELECT * FROM arrival_data WHERE "skuId" = ANY($1::int[])', [ids]);
    const beforeShipment = await client.query('SELECT * FROM shipment_data WHERE "skuId" = ANY($1::int[])', [ids]);
    const forecasts = await client.query('SELECT * FROM forecast_data WHERE "skuId" = ANY($1::int[])', [ids]);
    const actual = await client.query('SELECT * FROM actual_production_data WHERE "skuId" = ANY($1::int[])', [ids]);
    const foc = await client.query('SELECT * FROM foc_data WHERE country = $1 AND "skuId" = ANY($2::int[])', ["Syria", ids]);
    const fullProduction = fgProductionMap("Syria", forecasts.rows, actual.rows, foc.rows, beforeShipment.rows);
    for (const r of ims) await client.query(
      `INSERT INTO ims_data ("skuId","periodId",value,"isActual",source) VALUES ($1,$2,$3,$4,'ws_tracker')
       ON CONFLICT ("skuId","periodId") DO UPDATE SET value=EXCLUDED.value,"isActual"=EXCLUDED."isActual",source='ws_tracker',"updatedAt"=NOW()`,
      [r.skuId, r.periodId, r.value, r.isActual]);
    for (const r of arrivals) await client.query(
      `INSERT INTO arrival_data ("skuId","periodId",week1,week2,week3,week4) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT ("skuId","periodId") DO UPDATE SET week1=EXCLUDED.week1,week2=EXCLUDED.week2,week3=EXCLUDED.week3,week4=EXCLUDED.week4,"updatedAt"=NOW()`,
      [r.skuId, r.periodId, r.week1, r.week2, r.week3, r.week4]);
    if (owned.length) await client.query(
      `DELETE FROM clearance_events WHERE country='Syria' AND notes='WS Tracker' AND "containerRef"='WST' AND id = ANY($1::int[])`,
      [owned.map(e => e.id)]);
    for (const e of plan.clearance.events) await client.query(
      `INSERT INTO clearance_events ("skuId","periodId",country,"clearedQty","clearedDate",notes,"containerRef")
       VALUES ($1,$2,'Syria',$3,$4,'WS Tracker','WST')`, [e.skuId, e.periodId, String(e.qty), e.date]);
    // Rebuild only affected Syria batch summaries; do not touch production,
    // opening stock, adjustments, FOC or another country's data.
    const batches = new Map([...owned, ...plan.clearance.events].map(e => [`${e.skuId}-${e.periodId}`, e]));
    for (const e of batches.values()) await client.query(
      `INSERT INTO shipment_data ("skuId","periodId","clearedQty","clearedDate","arrivalStatus")
       SELECT $1,$2,NULLIF(c.qty,0),c.date::date,
         (CASE WHEN c.qty=0 THEN 'Pending' WHEN $3::numeric>0 AND c.qty>=$3::numeric THEN 'Cleared'
           ELSE 'Partially Cleared' END)::"arrivalStatus"
       FROM (SELECT COALESCE(SUM("clearedQty"),0) qty,MAX("clearedDate") date FROM clearance_events
         WHERE country='Syria' AND "skuId"=$1 AND "periodId"=$2 AND "clearedQty">0) c
       ON CONFLICT ("skuId","periodId") DO UPDATE SET "clearedQty"=EXCLUDED."clearedQty","clearedDate"=EXCLUDED."clearedDate",
         "arrivalStatus"=CASE WHEN EXCLUDED."clearedQty" IS NULL THEN
           CASE WHEN shipment_data."arrivalStatus" IN ('Cleared','Partially Cleared') THEN 'Arrived'::"arrivalStatus"
             ELSE shipment_data."arrivalStatus" END ELSE EXCLUDED."arrivalStatus" END,"updatedAt"=NOW()`,
      [e.skuId, e.periodId, fullProduction.get(`${e.skuId}-${e.periodId}`) ?? 0]);
    const touched = new Set(plan.rows.map(r => `${r.skuId}-${r.periodId}`));
    await client.query(
      `INSERT INTO audit_trail (country,username,action,sheet,details) VALUES ('Syria',$1,'upload','WS Tracker before-image',$2)`,
      [actor, JSON.stringify({ generatedAt: plan.feed.generatedAt, from: plan.feed.from, to: plan.feed.to,
        removedClearances: owned,
        ims: beforeIms.rows.filter(r => touched.has(`${r.skuId}-${r.periodId}`)),
        arrivals: beforeArrivals.rows.filter(r => touched.has(`${r.skuId}-${r.periodId}`)),
        shipment: beforeShipment.rows.filter(r => batches.has(`${r.skuId}-${r.periodId}`)),
        preservedClearanceIds: existing.rows.filter(e => !owned.some(o => o.id === e.id)).map(e => e.id) })]);
    await client.query("COMMIT");
    return owned.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
