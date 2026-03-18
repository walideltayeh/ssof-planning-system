import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

// Check if there are any forecast_data rows with Lebanon period IDs (1-36) 
// that were uploaded before the fix — these would have been Syria data stored in wrong place
const [lebanonPeriods] = await conn.query("SELECT id FROM periods WHERE country = 'Lebanon' ORDER BY id");
const lbIds = lebanonPeriods.map(p => p.id);
console.log('Lebanon period ID range:', lbIds[0], 'to', lbIds[lbIds.length - 1]);

// Check if there are any forecast rows using Lebanon period IDs
const [fdCount] = await conn.query('SELECT COUNT(*) as cnt FROM forecast_data WHERE periodId IN (?)', [lbIds]);
console.log('forecast_data rows using Lebanon period IDs:', fdCount[0].cnt);

// Check Lebanon SKU IDs
const [lbSkus] = await conn.query("SELECT id FROM skus WHERE country = 'Lebanon'");
const lbSkuIds = lbSkus.map(s => s.id);
console.log('Lebanon SKU IDs range:', lbSkuIds[0], 'to', lbSkuIds[lbSkuIds.length - 1]);

// Check all data rows and their SKU countries
const [allFd] = await conn.query(`
  SELECT s.country, COUNT(*) as cnt 
  FROM forecast_data fd 
  JOIN skus s ON fd.skuId = s.id 
  GROUP BY s.country
`);
console.log('forecast_data by SKU country:', allFd);

const [allSd] = await conn.query(`
  SELECT s.country, COUNT(*) as cnt 
  FROM shipment_data sd 
  JOIN skus s ON sd.skuId = s.id 
  GROUP BY s.country
`);
console.log('shipment_data by SKU country:', allSd);

const [allAd] = await conn.query(`
  SELECT s.country, COUNT(*) as cnt 
  FROM arrival_data ad 
  JOIN skus s ON ad.skuId = s.id 
  GROUP BY s.country
`);
console.log('arrival_data by SKU country:', allAd);

const [allPfg] = await conn.query(`
  SELECT s.country, COUNT(*) as cnt 
  FROM planning_fg_data pfg 
  JOIN skus s ON pfg.skuId = s.id 
  GROUP BY s.country
`);
console.log('planning_fg_data by SKU country:', allPfg);

// Also check period country distribution in data
const [fdByPeriodCountry] = await conn.query(`
  SELECT p.country as period_country, COUNT(*) as cnt 
  FROM forecast_data fd 
  JOIN periods p ON fd.periodId = p.id 
  GROUP BY p.country
`);
console.log('forecast_data by period country:', fdByPeriodCountry);

await conn.end();
