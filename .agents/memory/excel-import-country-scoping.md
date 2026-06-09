---
name: Excel import country scoping
description: Why the SSOF Excel import must resolve SKUs and periods per-country, not globally
---

# Excel import must scope SKUs and periods to the target country

Both `resolveSkuMap(country)` and `resolvePeriodMap(country)` in `server/excelImport.ts`
must build their lookup maps from **country-scoped** data
(`db.getSkusForCountry(country)` / `db.getPeriodsForCountry(country)`), never from the
global `db.getAllSkus()` / `db.getAllPeriods()`.

**Why:** Period labels (`Apr 25`) and some SKU names/weights (`Double Apple`, `Grape`)
are shared across countries. The lookup maps are keyed by canonical label / name and are
**last-wins**, so a global list resolves a target-country row to *another* country's
period ID or SKU ID. Those rows are then invisible: every read path
(`getPeriodsForCountry`, `getSkusForCountry`, e.g. `getFullPlanningData`) is country-scoped,
so it never reads the mis-keyed rows. The Lebanon import historically special-cased both to
the global getters and silently wrote ~972 rows/table against Libya period IDs.

**How to apply:** Keep import write-side period/SKU resolution country-scoped so it matches
the country-scoped read side. After any bulk import, sanity-check with: zero rows where a
country's SKU IDs pair with another country's period IDs (join `*_data` → `skus` →
`periods` and group by `periods.country`).
