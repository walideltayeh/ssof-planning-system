---
name: Syria warehouse stock reference
description: User's operational source-of-truth and approval boundaries for Syria warehouse stock.
---

For Syria only, the WS Tracker is the operational truth for Lattakia warehouse stock. SSOF must show its warehouse balance alongside the planner's closing balance and explain discrepancies by SKU.

**Why:** The user explicitly distinguished physical warehouse stock from the SSOF calculated balance and requested deliberate admin approval rather than silently replacing planner-entered stock.

**How to apply:** Read published warehouse balances and movements, reconcile the same dates and SKU scope, and offer an explicit admin apply action with country permissions. If warehouse balances or required movements are absent from the feed, report the missing fields and stop that part; do not derive or invent stock on hand. Do not extend this tracker-stock behavior to Lebanon, Libya or KSA without another request.
