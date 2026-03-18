import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

// Check all data by country
const [allFd] = await conn.query(`
  SELECT s.country, COUNT(*) as cnt, SUM(CASE WHEN fd.value != '0' THEN 1 ELSE 0 END) as nonzero
  FROM forecast_data fd JOIN skus s ON fd.skuId = s.id GROUP BY s.country
`);
console.log('forecast_data by country:', allFd);

const [allPfg] = await conn.query(`
  SELECT s.country, COUNT(*) as cnt, 
    SUM(CASE WHEN pfg.arrivals != '0' AND pfg.arrivals IS NOT NULL THEN 1 ELSE 0 END) as nonzero_arrivals,
    SUM(CASE WHEN pfg.invoiced != '0' AND pfg.invoiced IS NOT NULL THEN 1 ELSE 0 END) as nonzero_invoiced
  FROM planning_fg_data pfg JOIN skus s ON pfg.skuId = s.id GROUP BY s.country
`);
console.log('planning_fg_data by country:', allPfg);

const [allAd] = await conn.query(`
  SELECT s.country, COUNT(*) as cnt,
    SUM(CASE WHEN (ad.week1 != '0' OR ad.week2 != '0' OR ad.week3 != '0' OR ad.week4 != '0') THEN 1 ELSE 0 END) as nonzero
  FROM arrival_data ad JOIN skus s ON ad.skuId = s.id GROUP BY s.country
`);
console.log('arrival_data by country:', allAd);

// Check if Lebanon planning_fg has non-zero arrivals
const [lbPfgArrivals] = await conn.query(`
  SELECT pfg.skuId, pfg.periodId, pfg.arrivals, pfg.invoiced, pfg.openingStock
  FROM planning_fg_data pfg JOIN skus s ON pfg.skuId = s.id 
  WHERE s.country = 'Lebanon' AND pfg.arrivals != '0' AND pfg.arrivals IS NOT NULL
  LIMIT 10
`);
console.log('Lebanon planning_fg non-zero arrivals:', lbPfgArrivals.length, 'rows');

// Check Lebanon arrival_data non-zero
const [lbArrival] = await conn.query(`
  SELECT ad.skuId, ad.periodId, ad.week1, ad.week2, ad.week3, ad.week4
  FROM arrival_data ad JOIN skus s ON ad.skuId = s.id 
  WHERE s.country = 'Lebanon' AND (ad.week1 != '0' OR ad.week2 != '0' OR ad.week3 != '0' OR ad.week4 != '0')
  LIMIT 10
`);
console.log('Lebanon arrival_data non-zero rows:', lbArrival.length, 'rows');
if (lbArrival.length > 0) console.log('Sample:', lbArrival[0]);

await conn.end();
