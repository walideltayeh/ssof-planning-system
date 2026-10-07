---
name: Schema migration path
description: Managed schema publishing and the repo's broken migration journal
---

**Rule:** For Replit-managed PostgreSQL, do not add startup/deploy-time DDL. Update the schema source and development schema through supported development SQL; keep a hand-written SQL record. Publish applies the managed production schema diff. Do not use `pnpm db:push` in this repo.

**Why:** The database skill prohibits new production startup DDL because it bypasses the managed publishing schema workflow. The repository's migration journal is also inconsistent (a missing SQL file and unjournaled additions), so its generate/migrate command is not a reliable application path.

**How to apply:** Apply new DDL only to development, not to production or new startup helpers. Existing legacy startup DDL is not a precedent for new changes. Guarded, user-approved business-data imports on boot are separate from schema changes.
