import { createConnection } from 'mysql2/promise';
const conn = await createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query('SELECT id, name, weight, country, isActive FROM skus ORDER BY country, weight, name');
console.log('Total SKUs:', rows.length);
const byCountry = {};
for (const r of rows) {
  if (!byCountry[r.country]) byCountry[r.country] = [];
  byCountry[r.country].push(r);
}
for (const [country, skus] of Object.entries(byCountry)) {
  console.log(`\n=== ${country} (${skus.length} SKUs) ===`);
  for (const s of skus) {
    console.log(`  [${s.id}] [${s.weight}] ${s.name} (active=${s.isActive})`);
  }
}
await conn.end();
