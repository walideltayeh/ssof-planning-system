import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

const [skus] = await conn.query("SELECT id, name, weight, country FROM skus WHERE country = 'Syria'");
console.log('Syria SKUs:', skus.length);

const [periods] = await conn.query("SELECT COUNT(*) as cnt FROM periods WHERE country = 'Syria'");
console.log('Syria Periods:', periods[0].cnt);

// Check Syria period IDs
const [syriaPeriods] = await conn.query("SELECT id, year, month FROM periods WHERE country = 'Syria' ORDER BY year, month LIMIT 5");
console.log('First 5 Syria period IDs:', syriaPeriods);

const ids = skus.map(r => r.id);
console.log('Syria SKU IDs (first 5):', ids.slice(0, 5));

if (ids.length > 0) {
  const [fd] = await conn.query('SELECT COUNT(*) as cnt FROM forecast_data WHERE skuId IN (?)', [ids]);
  console.log('Syria forecast_data rows:', fd[0].cnt);
  const [sd] = await conn.query('SELECT COUNT(*) as cnt FROM shipment_data WHERE skuId IN (?)', [ids]);
  console.log('Syria shipment_data rows:', sd[0].cnt);
  const [ad] = await conn.query('SELECT COUNT(*) as cnt FROM arrival_data WHERE skuId IN (?)', [ids]);
  console.log('Syria arrival_data rows:', ad[0].cnt);
  const [pfg] = await conn.query('SELECT COUNT(*) as cnt FROM planning_fg_data WHERE skuId IN (?)', [ids]);
  console.log('Syria planning_fg_data rows:', pfg[0].cnt);

  // Check sample non-zero forecast values
  const [sample] = await conn.query(
    "SELECT skuId, periodId, value FROM forecast_data WHERE skuId IN (?) AND value != '0' LIMIT 5",
    [ids]
  );
  console.log('Sample non-zero Syria forecast rows:', sample);

  // Check what period IDs are used in Syria's forecast data
  const [periodIds] = await conn.query(
    'SELECT DISTINCT periodId FROM forecast_data WHERE skuId IN (?) LIMIT 5',
    [ids]
  );
  console.log('Period IDs used in Syria forecast:', periodIds.map(p => p.periodId));

  if (periodIds.length > 0) {
    const pids = periodIds.map(p => p.periodId);
    const [pInfo] = await conn.query('SELECT id, year, month, country FROM periods WHERE id IN (?)', [pids]);
    console.log('Period details for those IDs:', pInfo);
  }

  // Check arrival data sample
  const [arrSample] = await conn.query(
    "SELECT skuId, periodId, week1, week2, week3, week4 FROM arrival_data WHERE skuId IN (?) AND (week1 != '0' OR week2 != '0' OR week3 != '0' OR week4 != '0') LIMIT 5",
    [ids]
  );
  console.log('Sample non-zero Syria arrival rows:', arrSample);

  // Check planning_fg_data arrivals field
  const [pfgSample] = await conn.query(
    "SELECT skuId, periodId, arrivals FROM planning_fg_data WHERE skuId IN (?) AND arrivals != '0' LIMIT 5",
    [ids]
  );
  console.log('Sample non-zero Syria planning_fg arrivals:', pfgSample);
}

await conn.end();
