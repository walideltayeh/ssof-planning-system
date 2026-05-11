/**
 * One-time script: wipe all data rows for Syria and Libya.
 * Preserves: skus, periods, users, app_users, ssof_versions, version_comments, user_presence
 * Deletes: forecast_data, ims_data, shipment_data, arrival_data, planning_fg_data,
 *          clearance_events, actual_production_data, upload_history (Syria/Libya entries)
 */
import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

await conn.beginTransaction();

try {
  // Get Syria and Libya SKU IDs
  const [syriaSkus] = await conn.query("SELECT id FROM skus WHERE country = 'Syria'");
  const [libyaSkus] = await conn.query("SELECT id FROM skus WHERE country = 'Libya'");
  const syriaIds = syriaSkus.map(r => r.id);
  const libyaIds = libyaSkus.map(r => r.id);
  const allIds = [...syriaIds, ...libyaIds];

  console.log(`Syria SKUs: ${syriaIds.length}, Libya SKUs: ${libyaIds.length}`);

  if (allIds.length === 0) {
    console.log('No Syria/Libya SKUs found — nothing to delete.');
    await conn.rollback();
    await conn.end();
    process.exit(0);
  }

  // Tables that reference skuId
  const skuTables = ['forecast_data', 'ims_data', 'shipment_data', 'arrival_data', 'planning_fg_data', 'actual_production_data', 'clearance_events'];
  for (const table of skuTables) {
    const [res] = await conn.query(`DELETE FROM ${table} WHERE skuId IN (?)`, [allIds]);
    console.log(`Deleted ${res.affectedRows} rows from ${table}`);
  }

  // upload_history: delete entries tagged with Syria or Libya country
  const [uhRes] = await conn.query(`DELETE FROM upload_history WHERE country IN ('Syria', 'Libya')`);
  console.log(`Deleted ${uhRes.affectedRows} rows from upload_history`);

  await conn.commit();
  console.log('\n✅ Syria and Libya data wiped successfully. SKUs, periods, and users are intact.');

  // Verify
  console.log('\n--- Verification ---');
  for (const table of skuTables) {
    const [cnt] = await conn.query(`SELECT COUNT(*) as cnt FROM ${table} WHERE skuId IN (?)`, [allIds]);
    console.log(`${table}: ${cnt[0].cnt} Syria/Libya rows remaining`);
  }
  const [skuCnt] = await conn.query("SELECT country, COUNT(*) as cnt FROM skus WHERE country IN ('Syria','Libya') GROUP BY country");
  console.log('SKUs preserved:', skuCnt);

} catch (err) {
  await conn.rollback();
  console.error('❌ Error — rolled back:', err.message);
  process.exit(1);
}

await conn.end();
