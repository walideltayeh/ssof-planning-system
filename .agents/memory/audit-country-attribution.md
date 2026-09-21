---
name: Audit country attribution
description: audit_trail.country defaults to Lebanon, so an audit entry written without a country is silently attributed to Lebanon.
---
Every server mutation that changes country-scoped data must forward the request's country to its audit entry, and the client may only record non-data events (page views, exports, sign-out).

**Why:** the column default hid months of Syria/Libya changes under Lebanon, and the "last data update by country" indicator is built on this column, so an unattributed change makes one country look stale and another look freshly edited. Historic mis-attributed rows were not backfilled (their details don't carry the country).

**How to apply:** new data mutations include the country in their audit entry; read-only actions use an `export_` prefix or are added to the shared non-data list, otherwise they count as a data update.
