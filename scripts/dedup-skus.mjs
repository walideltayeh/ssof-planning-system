/**
 * Deduplication script: merges duplicate SKUs (same name + weight + country)
 * Keeps the SKU with the lowest ID, reassigns all data rows, then deletes duplicates.
 */
import { createConnection } from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

const conn = await createConnection(url);
console.log('Connected to database');

// 1. Find all duplicate SKUs (same name + weight + country)
const [dupes] = await conn.query(`
  SELECT name, weight, country, COUNT(*) as cnt, MIN(id) as keepId, GROUP_CONCAT(id ORDER BY id) as allIds
  FROM skus
  GROUP BY name, weight, country
  HAVING COUNT(*) > 1
`);

console.log(`Found ${dupes.length} duplicate SKU groups`);

const dataTables = [
  'forecast_data',
  'ims_data',
  'shipment_data',
  'arrival_data',
  'planning_fg_data',
];

for (const dup of dupes) {
  const ids = dup.allIds.split(',').map(Number);
  const keepId = dup.keepId;
  const removeIds = ids.filter(id => id !== keepId);
  
  console.log(`\nProcessing: "${dup.name}" ${dup.weight} (${dup.country})`);
  console.log(`  Keep ID: ${keepId}, Remove IDs: ${removeIds.join(', ')}`);

  for (const removeId of removeIds) {
    for (const table of dataTables) {
      // For each data row of the duplicate SKU, check if the keepId already has a row for that period
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE skuId = ?`, [removeId]);
      
      for (const row of rows) {
        const periodId = row.periodId;
        const [existing] = await conn.query(
          `SELECT id FROM ${table} WHERE skuId = ? AND periodId = ?`,
          [keepId, periodId]
        );
        
        if (existing.length > 0) {
          // keepId already has data for this period — check if the duplicate has non-zero data
          // If the duplicate has meaningful data, update the keepId row with it
          let hasData = false;
          if (table === 'forecast_data') {
            hasData = parseFloat(row.value || '0') !== 0;
            if (hasData) {
              await conn.query(`UPDATE ${table} SET value = ? WHERE skuId = ? AND periodId = ?`, [row.value, keepId, periodId]);
            }
          } else if (table === 'shipment_data' || table === 'arrival_data') {
            const w1 = parseFloat(row.week1 || '0');
            const w2 = parseFloat(row.week2 || '0');
            const w3 = parseFloat(row.week3 || '0');
            const w4 = parseFloat(row.week4 || '0');
            hasData = w1 + w2 + w3 + w4 !== 0;
            if (hasData) {
              await conn.query(
                `UPDATE ${table} SET week1 = ?, week2 = ?, week3 = ?, week4 = ? WHERE skuId = ? AND periodId = ?`,
                [row.week1, row.week2, row.week3, row.week4, keepId, periodId]
              );
            }
          }
          // Delete the duplicate row
          await conn.query(`DELETE FROM ${table} WHERE skuId = ? AND periodId = ?`, [removeId, periodId]);
        } else {
          // No existing row for keepId — reassign this row to keepId
          await conn.query(`UPDATE ${table} SET skuId = ? WHERE skuId = ? AND periodId = ?`, [keepId, removeId, periodId]);
        }
      }
      
      // Delete any remaining rows for the duplicate SKU
      await conn.query(`DELETE FROM ${table} WHERE skuId = ?`, [removeId]);
    }
    
    // Delete the duplicate SKU
    await conn.query(`DELETE FROM skus WHERE id = ?`, [removeId]);
    console.log(`  Deleted duplicate SKU ID: ${removeId}`);
  }
}

// Verify
const [remaining] = await conn.query(`
  SELECT name, weight, country, COUNT(*) as cnt
  FROM skus
  GROUP BY name, weight, country
  HAVING COUNT(*) > 1
`);
console.log(`\nRemaining duplicates after cleanup: ${remaining.length}`);
if (remaining.length === 0) {
  console.log('✅ All duplicates cleaned up successfully!');
} else {
  console.log('⚠️ Some duplicates remain:', remaining);
}

await conn.end();
