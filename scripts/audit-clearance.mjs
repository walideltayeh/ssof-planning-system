import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
const conn = await mysql.createConnection(url);

// Check all clearance events tables
const [tables] = await conn.query("SHOW TABLES LIKE '%clearance%'");
console.log('Clearance-related tables:', tables);

// Check all tables
const [allTables] = await conn.query("SHOW TABLES");
console.log('All tables:', allTables.map(t => Object.values(t)[0]));

await conn.end();
