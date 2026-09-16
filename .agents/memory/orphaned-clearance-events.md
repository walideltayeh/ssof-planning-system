---
name: Orphaned clearance events (Arrival vs Planning FG)
description: Why a batch that owns clearance events must always be listed on the Arrival page, and how production re-imports create FG double counts.
---

**Rule:** On the intl Arrival page, list every (sku, period) batch that owns clearance events, even when it has zero plan and zero actual production — flag it "no production" instead of hiding it. Planning FG shows a matching warning.

**Why:** Planning FG sums clearance events by *cleared date*, independent of the production batch they are attached to. A forecast Excel import for Syria re-syncs the Production (Shipment) table, which can move production out of a month AFTER clearances were logged against it. The Arrival page used to skip zero-production batches, so those events became invisible and undeletable while FG still counted them; when the user re-entered the arrivals under the correct batch, FG double-counted (Sept 2026: ~48.7k MC across Mar-26 and Aug-26 batches for Syria).

**How to apply:**
- Never reintroduce a "production > 0" filter as the only surfacing condition for Arrival batches.
- The same helper (`arrival.helpers.ts`) is used by Arrival and Planning FG so the orphan rule stays identical (actual = manual actual override else shipment weeks; planned = forecast).
- Dashboard tiles on Arrival (Expected / Still to Clear / confirmed counts) exclude orphan batches on both the plan and cleared side.
- Data cleanup normally happens through the app UI: banner → "Show only these" → expand batch → "Delete all N events". The Sept-2026 Syria duplicates were instead fixed by a guarded startup repair (see [startup data repairs](startup-data-repairs.md)); it is now in the "done" steady state and must stay in place (removing it is harmless, re-running is a no-op).
- User-confirmed data facts from that incident: Grape 50 MC produced/cleared May 2026 is Grape **50g** (not 1kg); 2025 and the Jan-20-2026 clearances are correct and must not be touched.
- Clearance-event delete/update are scoped by (id, country, skuId, periodId) and throw when nothing matches — do not relax this back to id-only.
