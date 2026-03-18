/**
 * Fast deduplication script using batch SQL operations.
 * For each duplicate SKU group: reassign all data from duplicate IDs to the keepId,
 * then delete duplicate rows and SKUs.
 */
import { createConnection } from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL not set');

const conn = await createConnection(url);
console.log('Connected to database');

// 1. Find all duplicate SKUs
const [dupes] = await conn.query(`
  SELECT name, weight, country, MIN(id) as keepId, GROUP_CONCAT(id ORDER BY id) as allIds
  FROM skus
  GROUP BY name, weight, country
  HAVING COUNT(*) > 1
`);

console.log(`Found ${dupes.length} duplicate SKU groups`);

const dataTables = ['forecast_data', 'ims_data', 'shipment_data', 'arrival_data', 'planning_fg_data'];

for (const dup of dupes) {
  const ids = dup.allIds.split(',').map(Number);
  const keepId = dup.keepId;
  const removeIds = ids.filter(id => id !== keepId);
  
  console.log(`\nProcessing: "${dup.name}" ${dup.weight} (${dup.country})`);
  console.log(`  Keep ID: ${keepId}, Remove IDs: ${removeIds.join(', ')}`);

  for (const removeId of removeIds) {
    for (const table of dataTables) {
      // Delete duplicate rows where keepId already has the same periodId (to avoid unique constraint violation)
      await conn.query(`
        DELETE FROM ${table} 
        WHERE skuId = ? 
        AND periodId IN (SELECT periodId FROM (SELECT periodId FROM ${table} WHERE skuId = ?) AS existing)
      `, [removeId, keepId]);
      
      // Reassign remaining rows from removeId to keepId
      await conn.query(`UPDATE ${table} SET skuId = ? WHERE skuId = ?`, [keepId, removeId]);
    }
    
    // Delete the duplicate SKU
    await conn.query(`DELETE FROM skus WHERE id = ?`, [removeId]);
    console.log(`  ✅ Deleted duplicate SKU ID: ${removeId}`);
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

// Show final SKU count
const [total] = await conn.query(`SELECT COUNT(*) as cnt FROM skus`);
console.log(`Total SKUs remaining: ${total[0].cnt}`);

await conn.end();
