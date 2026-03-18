import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

// Check Lebanon shipment data non-zero rows
const [sdCount] = await conn.query(`
  SELECT COUNT(*) as total,
    SUM(CASE WHEN (sd.week1 != '0' OR sd.week2 != '0' OR sd.week3 != '0' OR sd.week4 != '0') THEN 1 ELSE 0 END) as nonzero
  FROM shipment_data sd JOIN skus s ON sd.skuId = s.id WHERE s.country = 'Lebanon'
`);
console.log('Lebanon shipment_data:', sdCount[0]);

// Check shipment data for formula months (Dec 2025 onward)
const [sdFormula] = await conn.query(`
  SELECT sd.skuId, s.name as skuName, p.year, p.month, sd.week1, sd.week2, sd.week3, sd.week4
  FROM shipment_data sd 
  JOIN skus s ON sd.skuId = s.id 
  JOIN periods p ON sd.periodId = p.id
  WHERE s.country = 'Lebanon' 
    AND ((p.year = 2025 AND p.month = 12) OR (p.year = 2026 AND p.month = 1) OR (p.year = 2026 AND p.month >= 2))
    AND (sd.week1 != '0' OR sd.week2 != '0' OR sd.week3 != '0' OR sd.week4 != '0')
  LIMIT 10
`);
console.log('Lebanon shipment data for formula months (non-zero):', sdFormula.length, 'rows');
if (sdFormula.length > 0) console.log('Sample:', sdFormula[0]);

// Check arrival data for same months
const [adFormula] = await conn.query(`
  SELECT ad.skuId, s.name as skuName, p.year, p.month, ad.week1, ad.week2, ad.week3, ad.week4
  FROM arrival_data ad 
  JOIN skus s ON ad.skuId = s.id 
  JOIN periods p ON ad.periodId = p.id
  WHERE s.country = 'Lebanon' 
    AND ((p.year = 2025 AND p.month = 12) OR (p.year = 2026 AND p.month = 1) OR (p.year = 2026 AND p.month >= 2))
    AND (ad.week1 != '0' OR ad.week2 != '0' OR ad.week3 != '0' OR ad.week4 != '0')
  LIMIT 10
`);
console.log('Lebanon arrival data for formula months (non-zero):', adFormula.length, 'rows');
if (adFormula.length > 0) console.log('Sample:', adFormula[0]);

await conn.end();
