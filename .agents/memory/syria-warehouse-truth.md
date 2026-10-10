---
name: Syria warehouse stock reference
description: User's operational source-of-truth and approval boundaries for Syria warehouse stock.
---

For Syria only, the WS Tracker is the operational truth for Lattakia warehouse stock. SSOF must show its warehouse balance alongside the planner's closing balance and explain discrepancies by SKU.

**Why:** The user explicitly distinguished physical warehouse stock from the SSOF calculated balance and requested deliberate admin approval rather than silently replacing planner-entered stock.

**How to apply:** Read published warehouse balances and movements, reconcile the same dates and SKU scope, and offer an explicit admin apply action with country permissions. If warehouse balances or required movements are absent from the feed, report the missing fields and stop that part; do not derive or invent stock on hand. Do not extend this tracker-stock behavior to Lebanon, Libya or KSA without another request.

Distinguish the tracker-mapped product population from the full SSOF stock population. An IMS tie for mapped products does not prove that all SSOF sell-out is included in the tracker.

**Why:** The user confirmed matching IMS totals, but investigation found additional SSOF sell-out for a product not published by the tracker. Removing it to force a tie would silently overwrite planner data.

**How to apply:** Keep SSOF-only quantities, show the matched subset separately, and explain the stock effect of the wider scope. Production without clearance is not proof of physical delivery; attribute missing arrivals only where a tracker delivery provides evidence.

Until the tracker publishes stable delivery IDs, a manual clearance on the same SKU and date as a tracker delivery requires explicit review, not automatic deletion or addition.

**Why:** The feed supplies aggregate dated quantities. It cannot prove whether a manual record is an independent receipt, part of the tracker total, or a duplicate. Matching quantities alone cannot establish ownership, and older sync summaries cannot reconstruct deleted manual records.

**How to apply:** Keep the manual record intact and block the overlapping sync for review. Preserve outside-coverage and SSOF-only data rather than forcing a numerical tie. Use recoverable before-images for future syncs; investigate historical losses from actual backups, never from deletion counts alone.
