import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import * as db from "./db";
import { runSyriaClearanceDedup } from "./data-repairs/syriaClearanceDedup";

// __dirname shim for ESM (used in production build)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function normalizeUsernames(dbInstance: any) {
  // Defensive: ensure every app_users.username row is stored lowercase + trimmed
  // so the case-insensitive lookup in getAppUserByUsername always finds them.
  // NON-DESTRUCTIVE: if lowercasing would cause a collision with an existing
  // row, we LEAVE the conflicting row alone and log a warning so an operator
  // can resolve it manually. We never DELETE app_users rows from a migration.
  try {
    await dbInstance.execute(`
      DO $$
      DECLARE
        r RECORD;
        target TEXT;
        conflict_id INTEGER;
      BEGIN
        FOR r IN SELECT id, username FROM app_users
                 WHERE username <> LOWER(TRIM(username)) LOOP
          target := LOWER(TRIM(r.username));
          SELECT id INTO conflict_id FROM app_users
            WHERE LOWER(TRIM(username)) = target AND id <> r.id
            LIMIT 1;
          IF conflict_id IS NULL THEN
            UPDATE app_users SET username = target WHERE id = r.id;
          ELSE
            RAISE WARNING 'Username normalization skipped for id=% (% -> %) — conflicts with existing id=%', r.id, r.username, target, conflict_id;
          END IF;
        END LOOP;
      END $$;
    `);
  } catch (e: any) {
    console.warn(`[Migration] Username normalization skip: ${e.message}`);
  }
}

async function ensureSchemaColumns(dbInstance: any) {
  // Add any missing columns that may not exist in older production schemas
  const alterStatements = [
    `ALTER TABLE shipment_data ADD COLUMN IF NOT EXISTS "invoiceRef" varchar(200)`,
    `ALTER TABLE shipment_data ADD COLUMN IF NOT EXISTS "containerRef" varchar(200)`,
    `ALTER TABLE clearance_events ADD COLUMN IF NOT EXISTS "invoiceRef" varchar(200)`,
    `ALTER TABLE clearance_events ADD COLUMN IF NOT EXISTS "containerRef" varchar(200)`,
    `ALTER TABLE app_users ADD COLUMN IF NOT EXISTS "email" varchar(320)`,
    // July 2026: secondary supply-chain price list per SKU.
    // Trade-tier prices are $/MC; finalRspPerPack is $/pack. Null = not set.
    `ALTER TABLE skus ADD COLUMN IF NOT EXISTS "priceToWs" numeric(12,2)`,
    `ALTER TABLE skus ADD COLUMN IF NOT EXISTS "priceWsToSemiWs" numeric(12,2)`,
    `ALTER TABLE skus ADD COLUMN IF NOT EXISTS "priceSemiWsToRetail" numeric(12,2)`,
    `ALTER TABLE skus ADD COLUMN IF NOT EXISTS "finalRspPerPack" numeric(12,2)`,
    // July 2026: Trade Offers rework — DB-backed POSM list per country plus
    // per-channel FOC entitlement rules (buy X → get Y free; 1 outer = 10 packs).
    `CREATE TABLE IF NOT EXISTS "posm_items" (
      "id" serial PRIMARY KEY NOT NULL,
      "country" varchar(50) NOT NULL DEFAULT 'Lebanon',
      "name" varchar(255) NOT NULL,
      "unitValue" numeric(12,2),
      "channelQty" json,
      "priority" json,
      "rationale" text,
      "analysisSource" varchar(20),
      "analyzedAt" timestamp,
      "sortOrder" integer NOT NULL DEFAULT 0,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "posm_items_country_idx" ON "posm_items" ("country")`,
    `CREATE TABLE IF NOT EXISTS "trade_foc_rules" (
      "id" serial PRIMARY KEY NOT NULL,
      "country" varchar(50) NOT NULL DEFAULT 'Lebanon',
      "channel" varchar(30) NOT NULL,
      "entitled" boolean NOT NULL DEFAULT false,
      "buyQty" numeric(12,2),
      "buyUnit" varchar(10),
      "freeQty" numeric(12,2),
      "freeUnit" varchar(10),
      "notes" varchar(400),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "trade_foc_rules_country_channel_uq" ON "trade_foc_rules" ("country", "channel")`,
    // September 2026: Country Performance board pack — frozen packs, presenter
    // notes, per-user slide layout and the saved version used as annual plan.
    `CREATE TABLE IF NOT EXISTS "board_pack_snapshots" (
      "id" serial PRIMARY KEY NOT NULL,
      "country" varchar(50) NOT NULL,
      "name" varchar(255) NOT NULL,
      "windowLabel" varchar(100) NOT NULL,
      "headline" json NOT NULL,
      "frozenBy" varchar(100) NOT NULL,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS "board_pack_snapshots_country_idx" ON "board_pack_snapshots" ("country", "createdAt")`,
    `CREATE TABLE IF NOT EXISTS "presenter_notes" (
      "id" serial PRIMARY KEY NOT NULL,
      "country" varchar(50) NOT NULL,
      "periodKey" varchar(60) NOT NULL,
      "sectionId" varchar(60) NOT NULL,
      "body" text NOT NULL,
      "author" varchar(100) NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "presenter_notes_scope_uq" ON "presenter_notes" ("country", "periodKey", "sectionId")`,
    `CREATE TABLE IF NOT EXISTS "user_preferences" (
      "id" serial PRIMARY KEY NOT NULL,
      "username" varchar(100) NOT NULL,
      "key" varchar(100) NOT NULL,
      "value" json NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "user_preferences_user_key_uq" ON "user_preferences" ("username", "key")`,
    `CREATE TABLE IF NOT EXISTS "board_plan_baselines" (
      "id" serial PRIMARY KEY NOT NULL,
      "country" varchar(50) NOT NULL,
      "year" integer NOT NULL,
      "versionId" integer NOT NULL,
      "setBy" varchar(100) NOT NULL,
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS "board_plan_baselines_country_year_uq" ON "board_plan_baselines" ("country", "year")`,
    // May 2026: rename revised_forecast_data → actual_production_data.
    // Idempotent: only runs if old table exists and new one does not.
    `DO $$
     BEGIN
       IF to_regclass('public.revised_forecast_data') IS NOT NULL
          AND to_regclass('public.actual_production_data') IS NULL THEN
         EXECUTE 'ALTER TABLE revised_forecast_data RENAME TO actual_production_data';
         BEGIN
           EXECUTE 'ALTER INDEX revised_forecast_data_pkey RENAME TO actual_production_data_pkey';
         EXCEPTION WHEN undefined_object THEN NULL; END;
         BEGIN
           EXECUTE 'ALTER INDEX revised_forecast_data_sku_period_idx RENAME TO actual_production_data_sku_period_idx';
         EXCEPTION WHEN undefined_object THEN NULL; END;
       END IF;
     END $$`,
  ];
  for (const sql of alterStatements) {
    try {
      await dbInstance.execute(sql);
    } catch (e: any) {
      console.warn(`[Migration] Schema alter skip: ${e.message}`);
    }
  }
}

async function runDataRepairs(dbInstance: any) {
  try {
    const report = await runSyriaClearanceDedup(dbInstance);
    if (report.lockedByOther) {
      console.log("[DataRepair] Syria clearance dedup: another instance is running it, skipped.");
      return;
    }
    const applied = report.steps.filter((s) => s.state === "applied").length;
    const absent = report.steps.filter((s) => s.state === "absent").length;
    const inconsistent = report.steps.filter((s) => s.state === "inconsistent");
    if (applied === 0 && inconsistent.length === 0) {
      console.log(absent === report.steps.length
        ? "[DataRepair] Syria clearance dedup: no matching events in this database, nothing to repair."
        : "[DataRepair] Syria clearance dedup: already applied, nothing to do.");
    }
    // Anything that is neither applied nor cleanly done needs a human look —
    // it is never guessed at, only reported.
    for (const step of inconsistent) {
      console.warn(`[DataRepair] Syria clearance dedup: event #${step.id} left alone — ${step.detail}`);
    }
  } catch (e: any) {
    // A failed repair must never block the app from starting; the whole
    // transaction rolled back, so the next start simply tries again.
    console.error(`[DataRepair] Syria clearance dedup failed (will retry on next start): ${e?.message ?? e}`);
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

    // Force every existing username to its canonical lowercase form so
    // case-insensitive login always works, even for legacy/imported rows.
    await normalizeUsernames(dbInstance);

    // One-off, idempotent data repairs (each is a no-op once applied).
    await runDataRepairs(dbInstance);

    const { getSkusForCountry, restoreSnapshot, importClearanceEvent } = db;

    const seedFilePath = path.join(__dirname, "seed-data.json");
    if (!fs.existsSync(seedFilePath)) {
      console.log("[Migration] No seed-data.json found. Skipping startup migration.");
      return;
    }

    const raw = fs.readFileSync(seedFilePath, "utf-8");
    const payload = JSON.parse(raw);

    if (!payload?.snapshots) {
      console.error("[Migration] seed-data.json missing snapshots field.");
      return;
    }

    // PER-COUNTRY seed: only restore countries that have zero SKUs in the
    // target DB. This handles the case where a deployment's DB was hand-seeded
    // with one country's data (e.g. Lebanon only) and never got the other
    // markets — without this, the original "if Lebanon exists, skip everything"
    // gate would leave Syria/Libya/KSA permanently empty.
    const countries = ["Lebanon", "Syria", "Libya", "KSA"] as const;
    const combined: any = {
      skus: [], periods: [], forecast: [], ims: [],
      shipment: [], arrival: [], planningFg: [],
    };
    const countriesToSeed: string[] = [];
    for (const country of countries) {
      const existing = await getSkusForCountry(country);
      if (existing.length > 0) {
        console.log(`[Migration] ${country}: ${existing.length} SKUs already present. Skipping.`);
        continue;
      }
      const snap = payload.snapshots[country];
      if (!snap) {
        console.log(`[Migration] ${country}: no seed snapshot in seed-data.json. Skipping.`);
        continue;
      }
      countriesToSeed.push(country);
      combined.skus.push(...(snap.skus ?? []));
      combined.periods.push(...(snap.periods ?? []));
      combined.forecast.push(...(snap.forecast ?? []));
      combined.ims.push(...(snap.ims ?? []));
      combined.shipment.push(...(snap.shipment ?? []));
      combined.arrival.push(...(snap.arrival ?? []));
      combined.planningFg.push(...(snap.planningFg ?? []));
    }

    if (countriesToSeed.length === 0) {
      console.log("[Migration] All countries already seeded. Skipping.");
      return;
    }

    console.log(`[Migration] Seeding missing countries: ${countriesToSeed.join(", ")}...`);
    await restoreSnapshot(combined);
    console.log(`[Migration] Restored ${combined.skus.length} SKUs, ${combined.periods.length} periods across ${countriesToSeed.length} country(ies).`);

    if (payload.clearanceEvents) {
      let evCount = 0;
      for (const country of countriesToSeed) {
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
