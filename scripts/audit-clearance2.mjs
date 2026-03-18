import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

// Check clearance_events table structure
const [cols] = await conn.query("DESCRIBE clearance_events");
console.log('clearance_events columns:', cols.map(c => c.Field));

// Count all clearance events
const [total] = await conn.query("SELECT COUNT(*) as cnt FROM clearance_events");
console.log('Total clearance events:', total[0].cnt);

// Check clearance events with SKU country info
const [events] = await conn.query(`
  SELECT ce.*, s.name as skuName, s.weight, s.country as skuCountry
  FROM clearance_events ce
  JOIN skus s ON ce.skuId = s.id
  ORDER BY ce.id
`);
console.log('All clearance events with SKU country:');
for (const ev of events) {
  console.log(`  ID=${ev.id} SKU=${ev.skuName}(${ev.weight}) country=${ev.skuCountry} clearedQty=${ev.clearedQty} clearedDate=${ev.clearedDate} periodId=${ev.periodId}`);
}

// Check if 8206 appears anywhere
const [match8206] = await conn.query("SELECT * FROM clearance_events WHERE clearedQty LIKE '%8206%' OR clearedQty = '8206'");
console.log('Events with 8206:', match8206);

// Check shipment data for Double Apple 50g Syria
const [syriaSkus] = await conn.query("SELECT id, name, weight FROM skus WHERE country = 'Syria' AND name LIKE '%Double Apple%' AND weight = '50g'");
console.log('Syria Double Apple 50g SKUs:', syriaSkus);

if (syriaSkus.length > 0) {
  const skuIds = syriaSkus.map(s => s.id);
  const [shipRows] = await conn.query('SELECT sd.*, p.year, p.month FROM shipment_data sd JOIN periods p ON sd.periodId = p.id WHERE sd.skuId IN (?) ORDER BY p.year, p.month', [skuIds]);
  console.log('Syria Double Apple 50g shipment rows:', shipRows.length);
  
  const [ceRows] = await conn.query('SELECT * FROM clearance_events WHERE skuId IN (?)', [skuIds]);
  console.log('Syria Double Apple 50g clearance events:', ceRows);
}

await conn.end();
