import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as db from "./db";

// __dirname shim for ESM (used in production build)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureSchemaColumns(dbInstance: any) {
  // Add any missing columns that may not exist in older production schemas
  const alterStatements = [
    `ALTER TABLE shipment_data ADD COLUMN IF NOT EXISTS "invoiceRef" varchar(200)`,
    `ALTER TABLE shipment_data ADD COLUMN IF NOT EXISTS "containerRef" varchar(200)`,
    `ALTER TABLE clearance_events ADD COLUMN IF NOT EXISTS "invoiceRef" varchar(200)`,
    `ALTER TABLE clearance_events ADD COLUMN IF NOT EXISTS "containerRef" varchar(200)`,
    `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS "email" varchar(320)`,
  ];
  for (const sql of alterStatements) {
    try {
      await dbInstance.execute(sql);
    } catch (e: any) {
      console.warn(`[Migration] Schema alter skip: ${e.message}`);
    }
  }
}

export async function runStartupMigration() {
  try {
    const dbInstance = await (db as any).getDb?.();
    if (!dbInstance) {
      console.log("[Migration] DB not available, skipping startup migration.");
      return;
    }

    // Ensure any new columns exist in the schema (idempotent)
    await ensureSchemaColumns(dbInstance);

    // Check if DB is already seeded
    const { getSkusForCountry, restoreSnapshot, importClearanceEvent } = db;
    const existing = await getSkusForCountry("Lebanon");
    if (existing.length > 0) {
      console.log(`[Migration] DB already seeded (${existing.length} Lebanon SKUs found). Skipping.`);
      return;
    }

    const seedFilePath = path.join(__dirname, "seed-data.json");
    if (!fs.existsSync(seedFilePath)) {
      console.log("[Migration] No seed-data.json found. Skipping startup migration.");
      return;
    }

    console.log("[Migration] DB is empty. Running startup seed migration...");
    const raw = fs.readFileSync(seedFilePath, "utf-8");
    const payload = JSON.parse(raw);

    if (!payload?.snapshots) {
      console.error("[Migration] seed-data.json missing snapshots field.");
      return;
    }

    const countries = ["Lebanon", "Syria", "Libya"] as const;
    const combined: any = {
      skus: [], periods: [], forecast: [], ims: [],
      shipment: [], arrival: [], planningFg: [],
    };
    for (const country of countries) {
      const snap = payload.snapshots[country];
      if (snap) {
        combined.skus.push(...(snap.skus ?? []));
        combined.periods.push(...(snap.periods ?? []));
        combined.forecast.push(...(snap.forecast ?? []));
        combined.ims.push(...(snap.ims ?? []));
        combined.shipment.push(...(snap.shipment ?? []));
        combined.arrival.push(...(snap.arrival ?? []));
        combined.planningFg.push(...(snap.planningFg ?? []));
      }
    }

    await restoreSnapshot(combined);
    console.log(`[Migration] Restored ${combined.skus.length} SKUs, ${combined.periods.length} periods.`);

    if (payload.clearanceEvents) {
      let evCount = 0;
      for (const country of countries) {
        const events = payload.clearanceEvents[country];
        if (!events?.length) continue;
        for (const ev of events) {
          try {
            await importClearanceEvent(ev);
            evCount++;
          } catch (e: any) {
            console.warn(`[Migration] clearance event ${ev.id} skip: ${e.message}`);
          }
        }
      }
      console.log(`[Migration] Imported ${evCount} clearance events.`);
    }

    console.log("[Migration] Startup migration complete.");
  } catch (err: any) {
    console.error("[Migration] Startup migration failed:", err?.message || err);
  }
}
