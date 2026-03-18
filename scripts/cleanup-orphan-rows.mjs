/**
 * One-time cleanup script: delete orphan data rows from Lebanon tables
 * whose skuId belongs to Syria or Libya SKUs.
 *
 * Run once with: node scripts/cleanup-orphan-rows.mjs
 *
 * Safe to run multiple times — subsequent runs will find 0 orphan rows.
 */

import { createConnection } from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const TABLES = [
  "forecast_data",
  "ims_data",
  "shipment_data",
  "arrival_data",
  "planning_fg_data",
];

async function run() {
  const conn = await createConnection(DATABASE_URL);
  console.log("✅ Connected to database.\n");

  try {
    // 1. Identify non-Lebanon SKU IDs
    const [nonLebSkus] = await conn.query(
      "SELECT id, name, country FROM skus WHERE country != 'Lebanon'"
    );

    if (nonLebSkus.length === 0) {
      console.log("ℹ️  No non-Lebanon SKUs found. Nothing to clean up.");
      return;
    }

    const nonLebIds = nonLebSkus.map((r) => r.id);
    console.log(
      `Found ${nonLebIds.length} non-Lebanon SKUs (Syria + Libya):`
    );
    const byCountry = {};
    for (const s of nonLebSkus) {
      byCountry[s.country] = (byCountry[s.country] || 0) + 1;
    }
    for (const [country, count] of Object.entries(byCountry)) {
      console.log(`  ${country}: ${count} SKUs`);
    }
    console.log();

    const placeholders = nonLebIds.map(() => "?").join(",");

    // 2. Audit phase — count orphan rows per table
    console.log("── Audit (before cleanup) ──────────────────────────────");
    let totalOrphans = 0;
    for (const table of TABLES) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE skuId IN (${placeholders})`,
        nonLebIds
      );
      const count = Number(rows[0].cnt);
      totalOrphans += count;
      console.log(`  ${table.padEnd(20)} ${count} orphan rows`);
    }
    console.log(`  ${"TOTAL".padEnd(20)} ${totalOrphans} orphan rows`);
    console.log();

    if (totalOrphans === 0) {
      console.log("✅ No orphan rows found. Database is already clean.");
      return;
    }

    // 3. Delete phase — remove orphan rows inside a transaction
    console.log("── Cleanup (deleting orphan rows) ──────────────────────");
    await conn.beginTransaction();
    try {
      let totalDeleted = 0;
      for (const table of TABLES) {
        const [result] = await conn.query(
          `DELETE FROM ${table} WHERE skuId IN (${placeholders})`,
          nonLebIds
        );
        const deleted = result.affectedRows;
        totalDeleted += deleted;
        console.log(`  ${table.padEnd(20)} deleted ${deleted} rows`);
      }
      await conn.commit();
      console.log();
      console.log(`✅ Cleanup complete. ${totalDeleted} orphan rows deleted.`);
    } catch (err) {
      await conn.rollback();
      console.error("❌ Error during cleanup — transaction rolled back:", err.message);
      throw err;
    }

    // 4. Verify phase — confirm 0 orphan rows remain
    console.log();
    console.log("── Verification (after cleanup) ────────────────────────");
    let remaining = 0;
    for (const table of TABLES) {
      const [rows] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM ${table} WHERE skuId IN (${placeholders})`,
        nonLebIds
      );
      const count = Number(rows[0].cnt);
      remaining += count;
      console.log(
        `  ${table.padEnd(20)} ${count} orphan rows ${count === 0 ? "✅" : "❌ STILL HAS ROWS"}`
      );
    }
    console.log();
    if (remaining === 0) {
      console.log("✅ All tables verified clean. No orphan rows remain.");
    } else {
      console.error(`❌ ${remaining} orphan rows still remain — manual investigation required.`);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  console.error("❌ Fatal error:", err.message);
  process.exit(1);
});
