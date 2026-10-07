---
name: Recorded FOC traceability and past-period entry
description: Business constraints for Libya/Syria past-month FOC, individual source lines, receipt decisions and rollback.
---
Country administrators in Libya/Syria may enter or correct FOC and Received states in any existing period, including past months. Ordered forecast rules must remain unchanged. Keep this on Forecast Production, not a new page or permanent empty sub-rows.

**Why:** The user requested self-service past-month FOC without returning to an oversized redesign or reopening ordinary ordered forecast editing.

**How to apply:** Preserve the compact spreadsheet. Support repeated SKU/month entries that sum while retaining their original Date, Acc Type, Sales Manager, Flavor, Weight, Packaging and exact MC quantity. Never guess ambiguous matches or silently drop invalid rows; require preview and explicit confirmation.

Manual FOC identity entry must use one searchable registered-SKU selector, not separate typed Flavor/Weight/Packaging fields. Offer only active SKUs for the selected country in the planning grid's order; repeated SKU/month selections remain allowed. Months must be selected from existing country periods. Full name, weight and packaging must be readable in options and the closed selection without hovering or ellipses.

**Why:** The user explicitly rejected typed flavour entry because registered SKUs should prevent mistakes. Libya has Double Apple and Mint variants differing only by weight/packaging; the user reported truncated labels made correct selection impossible.

**How to apply:** Keep Excel paste as text mapped through the existing name/weight/packaging aliases, retaining the original source text. Explicitly flag inactive pasted matches; do not silently accept them or use free-text identity inputs to repair them. Size lists to content rather than trigger width, bound them by the viewport, wrap long descriptions and visually distinguish packaging with a badge.

Receipt eligibility belongs to each original line, not only the monthly aggregate. Legitimate sibling lines are not duplicates of each other, but their combined received amount may duplicate an existing arrival. Corrections must retain original source lines and quantities; signed negative correction lines are unsafe when some receipts are already counted in arrivals.

**Why:** One monthly total can contain both received and unreceived FOC, or one duplicate receipt alongside another legitimate shipment. A single checkbox or netted quantity loses those distinctions.

**How to apply:** Calculate stock from eligible received lines using the authoritative Planning FG ledger; preview affected and subsequent months, including unchanged values under an excluded basis. Keep original details inspectable and unknown legacy actors/times explicitly unknown.

FOC entry rollback should restore only that country's FOC ledger, not unrelated paid forecasts, IMS or arrivals.

**Why:** A full-board rollback after a small FOC correction can overwrite subsequent work unrelated to the correction.

**How to apply:** Save the FOC-only backup, changes and authenticated audit together in one transaction; require a fresh preview when source data changes. Restore still requires country-admin authorization and country-scoped SKU/month validation.
