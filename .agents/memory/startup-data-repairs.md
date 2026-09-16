---
name: Startup data repairs (production DB is agent-read-only)
description: How to change live production data when the agent cannot write to the production DB — guarded, idempotent, single-transaction repair run at boot, rehearsed against the dev DB inside a rolled-back transaction.
---

**Rule:** The agent can only READ the production database. When live data must be corrected (and the UI path is too painful for the user), ship a one-off repair in `server/data-repairs/` invoked from `runStartupMigration()` — never hand-run SQL, never `db:push`.

**Why:** Sept 2026: 16 duplicate Syria clearance events had to be merged. The user asked for it to be done for them; the only write path to production is code that runs when they publish. Publishing is therefore the user's consent point — say exactly what the repair will change before they publish.

**How to apply:**
- Hard-code the exact expected state (ids, country, sku, batch, qty, date) and only act when EVERY row matches; anything else is reported as `inconsistent` and left alone. Distinguish `applied` / `done` (already in a good end state) / `absent` (rows never existed, e.g. dev) so boot logs stay quiet in the steady state.
- One transaction for the whole run, including derived-row re-syncs (shipment cleared qty/status), so a crash is all-or-nothing and the next boot retries. `pg_try_advisory_xact_lock` + `SET LOCAL lock_timeout/statement_timeout` so autoscale instances never queue behind each other; wrap the call in try/catch so a failure never blocks start-up.
- Rehearse it for real: a vitest that seeds the exact production rows (same ids — check they are free in dev first) inside `db.transaction` and throws to roll back. Dev shares SKU/period ids with prod for Syria, so fixtures can use real ids. Sequences advance even on rollback; harmless.
- Write audit_trail entries under a system actor (`system:data-repair`) so the change shows in the edit history.
- The user may publish at any moment while you are still working (they did, mid-rework) — keep the working tree deployable at every step: typecheck + tests green before each edit lands, no half-written repair files.
- Existing helpers that use `getDb()` internally write OUTSIDE your transaction; add a `...With(dbHandle, ...)` variant (done for `syncShipmentClearedFromEventsWith`) instead of calling the wrapper.
