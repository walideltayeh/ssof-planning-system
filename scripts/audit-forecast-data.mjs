import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import { sql, and, ne, eq, inArray } from 'drizzle-orm';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(conn);

// Raw queries to understand data
const [imsRows] = await conn.execute(`
  SELECT p.year, p.month, s.name, s.weight, i.value
  FROM ims_data i
  JOIN skus s ON s.id = i.skuId
  JOIN periods p ON p.id = i.periodId
  WHERE s.country = 'Lebanon' AND i.value != '0' AND CAST(i.value AS DECIMAL) > 0
  ORDER BY p.year, p.month, s.name, s.weight
`);

const [forecastRows] = await conn.execute(`
  SELECT p.year, p.month, s.name, s.weight, f.value
  FROM forecast_data f
  JOIN skus s ON s.id = f.skuId
  JOIN periods p ON p.id = f.periodId
  WHERE s.country = 'Lebanon' AND f.value != '0' AND CAST(f.value AS DECIMAL) > 0
  ORDER BY p.year, p.month, s.name, s.weight
`);

// Summarize by month
const imsByMonth = {};
for (const row of imsRows) {
  const key = `${row.year}-${String(row.month).padStart(2,'0')}`;
  if (!imsByMonth[key]) imsByMonth[key] = { total: 0, skus: 0 };
  imsByMonth[key].total += parseFloat(row.value);
  imsByMonth[key].skus++;
}

const fcByMonth = {};
for (const row of forecastRows) {
  const key = `${row.year}-${String(row.month).padStart(2,'0')}`;
  if (!fcByMonth[key]) fcByMonth[key] = { total: 0, skus: 0 };
  fcByMonth[key].total += parseFloat(row.value);
  fcByMonth[key].skus++;
}

console.log('=== IMS Data by Month (Lebanon) ===');
for (const [k, v] of Object.entries(imsByMonth).sort()) {
  console.log(`  ${k}: total=${v.total.toFixed(0)} mastercases, ${v.skus} SKU-rows`);
}

console.log('\n=== Forecast Data by Month (Lebanon) ===');
for (const [k, v] of Object.entries(fcByMonth).sort()) {
  console.log(`  ${k}: total=${v.total.toFixed(0)} mastercases, ${v.skus} SKU-rows`);
}

// Per-SKU IMS summary
const skuTotals = {};
for (const row of imsRows) {
  const key = `${row.name} ${row.weight}`;
  if (!skuTotals[key]) skuTotals[key] = { total: 0, months: 0 };
  skuTotals[key].total += parseFloat(row.value);
  skuTotals[key].months++;
}
console.log('\n=== Per-SKU IMS Summary (Lebanon) ===');
for (const [k, v] of Object.entries(skuTotals).sort((a,b) => b[1].total - a[1].total)) {
  console.log(`  ${k}: total=${v.total.toFixed(0)}, avg/month=${(v.total/v.months).toFixed(0)}, months=${v.months}`);
}

await conn.end();
