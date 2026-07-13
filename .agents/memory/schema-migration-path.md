---
name: Schema migration path
description: How to add columns safely — drizzle-kit migrate is broken in this repo
---

**Rule:** Do not use `pnpm db:push` (drizzle-kit generate && migrate) to apply schema changes. Add an idempotent `ALTER TABLE ... IF NOT EXISTS` to `ensureSchemaColumns` in `server/startup-migration.ts` (runs on every boot, dev and prod) and mirror it in a hand-written SQL file in `drizzle/migrations/` for the record.

**Why:** The drizzle migration journal is inconsistent — it references a `0005_*.sql` file that no longer exists, and `0008_*.sql` was hand-added outside the journal — so `drizzle-kit migrate` always fails, and `drizzle-kit generate` stalls on an interactive create-vs-rename prompt for `actual_production_data`.

**How to apply:** Any schema change → edit both `drizzle/schema.ts` (Drizzle types) and `startup-migration.ts` (actual DDL), then restart the workflow to apply to the dev DB. Prod picks it up on next deploy boot.
