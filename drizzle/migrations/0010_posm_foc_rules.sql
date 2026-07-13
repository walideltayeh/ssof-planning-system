-- Trade Offers rework: DB-backed POSM list + per-channel FOC entitlement rules.
-- Hand-written (drizzle-kit journal is broken); mirrored idempotently in
-- server/startup-migration.ts which is what actually applies it on boot.

CREATE TABLE IF NOT EXISTS "posm_items" (
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
);
CREATE INDEX IF NOT EXISTS "posm_items_country_idx" ON "posm_items" ("country");

CREATE TABLE IF NOT EXISTS "trade_foc_rules" (
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
);
CREATE UNIQUE INDEX IF NOT EXISTS "trade_foc_rules_country_channel_uq" ON "trade_foc_rules" ("country", "channel");
