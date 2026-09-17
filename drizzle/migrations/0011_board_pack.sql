-- Country Performance board pack: frozen packs, presenter notes, per-user slide
-- layout and the saved version chosen as the approved annual plan.
-- Hand-written (drizzle-kit journal is broken); mirrored idempotently in
-- server/startup-migration.ts which is what actually applies it on boot.

CREATE TABLE IF NOT EXISTS "board_pack_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "country" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "windowLabel" varchar(100) NOT NULL,
  "headline" json NOT NULL,
  "frozenBy" varchar(100) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "board_pack_snapshots_country_idx" ON "board_pack_snapshots" ("country", "createdAt");

CREATE TABLE IF NOT EXISTS "presenter_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "country" varchar(50) NOT NULL,
  "periodKey" varchar(60) NOT NULL,
  "sectionId" varchar(60) NOT NULL,
  "body" text NOT NULL,
  "author" varchar(100) NOT NULL,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "presenter_notes_scope_uq" ON "presenter_notes" ("country", "periodKey", "sectionId");

CREATE TABLE IF NOT EXISTS "user_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "username" varchar(100) NOT NULL,
  "key" varchar(100) NOT NULL,
  "value" json NOT NULL,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_preferences_user_key_uq" ON "user_preferences" ("username", "key");

CREATE TABLE IF NOT EXISTS "board_plan_baselines" (
  "id" serial PRIMARY KEY NOT NULL,
  "country" varchar(50) NOT NULL,
  "year" integer NOT NULL,
  "versionId" integer NOT NULL,
  "setBy" varchar(100) NOT NULL,
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "board_plan_baselines_country_year_uq" ON "board_plan_baselines" ("country", "year");
