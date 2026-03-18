import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

// Check Lebanon arrival_data with period details
const [arrData] = await conn.query(`
  SELECT ad.skuId, s.name as skuName, p.year, p.month, p.country as periodCountry,
    ad.week1, ad.week2, ad.week3, ad.week4
  FROM arrival_data ad 
  JOIN skus s ON ad.skuId = s.id 
  JOIN periods p ON ad.periodId = p.id
  WHERE s.country = 'Lebanon' AND (ad.week1 != '0' OR ad.week2 != '0' OR ad.week3 != '0' OR ad.week4 != '0')
  LIMIT 10
`);
console.log('Lebanon arrival_data (non-zero) with period country:', arrData);

// Check Lebanon planning_fg arrivals with period details
const [pfgData] = await conn.query(`
  SELECT pfg.skuId, s.name as skuName, p.year, p.month, p.country as periodCountry,
    pfg.arrivals, pfg.invoiced
  FROM planning_fg_data pfg 
  JOIN skus s ON pfg.skuId = s.id 
  JOIN periods p ON pfg.periodId = p.id
  WHERE s.country = 'Lebanon' AND pfg.arrivals != '0' AND pfg.arrivals IS NOT NULL
  LIMIT 10
`);
console.log('Lebanon planning_fg (non-zero arrivals) with period country:', pfgData);

// Check if there are arrival_data rows with Lebanon SKUs but non-Lebanon period IDs
const [mismatch] = await conn.query(`
  SELECT COUNT(*) as cnt
  FROM arrival_data ad 
  JOIN skus s ON ad.skuId = s.id 
  JOIN periods p ON ad.periodId = p.id
  WHERE s.country = 'Lebanon' AND p.country != 'Lebanon'
`);
console.log('Lebanon SKU arrival rows with non-Lebanon period IDs:', mismatch[0].cnt);

// Check if planning_fg has Lebanon SKUs with non-Lebanon period IDs
const [pfgMismatch] = await conn.query(`
  SELECT COUNT(*) as cnt
  FROM planning_fg_data pfg 
  JOIN skus s ON pfg.skuId = s.id 
  JOIN periods p ON pfg.periodId = p.id
  WHERE s.country = 'Lebanon' AND p.country != 'Lebanon'
`);
console.log('Lebanon SKU planning_fg rows with non-Lebanon period IDs:', pfgMismatch[0].cnt);

await conn.end();
