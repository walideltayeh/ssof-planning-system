---
name: Recorded FOC traceability and past-period entry
description: Business constraints for Libya/Syria past-month FOC, individual source lines, receipt decisions and rollback.
---
Country administrators in Libya/Syria may enter or correct FOC and Received states in any existing period, including past months. Ordered forecast rules must remain unchanged. FOC belongs on a separate sidebar FOC Record page, never on Forecast Production.

**Why:** The user explicitly replaced the earlier same-page approach with a complete separation, while preserving all saved data and restoring the original Forecast Production design.

**How to apply:** Match the original Forecast grid's density, typography, colours, SKU panels and totals on FOC Record. Support repeated SKU/month entries that sum while retaining their original Date, Acc Type, Sales Manager, Flavor, Weight, Packaging and exact MC quantity. Never guess ambiguous matches or silently drop invalid rows; require preview and explicit confirmation for quantity, receipt and deletion changes.

Put FOC Record directly below Forecast Production, only for Libya and Syria; all other sidebar ordering stays unchanged. Forecast Production must use its original pre-FOC header, not the subsequently modified header. FOC Record must use that same sheet design, with Forecast Production vs Actual as the other reference.

**Why:** The user explicitly corrected the previous restoration: the original labels, year/month layout, heights, spacing, colours and borders take priority over new behaviour.

**How to apply:** Keep sticky header behaviour only if its appearance is pixel-identical to the original; otherwise drop the sticky behaviour. Do not reinterpret the original muted header as a dark red redesign. Only FOC content and Received controls should distinguish FOC Record's table.

Manual FOC identity entry must use one searchable registered-SKU selector, not separate typed Flavor/Weight/Packaging fields. Offer only active SKUs for the selected country in the planning grid's order; repeated SKU/month selections remain allowed. Months must be selected from existing country periods. Full name, weight and packaging must be readable in options and the closed selection without hovering or ellipses.

**Why:** The user explicitly rejected typed flavour entry because registered SKUs should prevent mistakes. Libya has Double Apple and Mint variants differing only by weight/packaging; the user reported truncated labels made correct selection impossible.

**How to apply:** Keep Excel paste as text mapped through the existing name/weight/packaging aliases, retaining the original source text. Explicitly flag inactive pasted matches; do not silently accept them or use free-text identity inputs to repair them. Size lists to content rather than trigger width, bound them by the viewport, wrap long descriptions and visually distinguish packaging with a badge.

Receipt eligibility belongs to each original line, not only the monthly aggregate. Legitimate sibling lines are not duplicates of each other, but their combined received amount may duplicate an existing arrival. Corrections must retain original source lines and quantities; signed negative correction lines are unsafe when some receipts are already counted in arrivals.

**Why:** One monthly total can contain both received and unreceived FOC, or one duplicate receipt alongside another legitimate shipment. A single checkbox or netted quantity loses those distinctions.

**How to apply:** Calculate operational Arrival and Planning FG stock from eligible received lines independently of Analysis's Include FOC comparison switch. Unreceived FOC never affects stock. Keep duplicate receipts held for review, original details inspectable and unknown legacy actors/times explicitly unknown.

FOC entry rollback should restore only that country's FOC ledger, not unrelated paid forecasts, IMS or arrivals.

**Why:** A full-board rollback after a small FOC correction can overwrite subsequent work unrelated to the correction.

**How to apply:** Save the FOC-only backup, changes and authenticated audit together in one transaction; require a fresh preview when source data changes. Restore still requires country-admin authorization and country-scoped SKU/month validation.

Administrators must be able to reassign FOC without retyping it: whole SKU row by default, selected months, a month range, or a single monthly cell. Merge source and target lines without replacing either set, preserving original details, line quantities and individual Received states. Preview both full SKU identities, monthly and overall totals, arrivals and future closing-stock effects before saving.

**Why:** The user needs to correct a wrong registered SKU while retaining the original evidence and receipt eligibility, with an audited FOC-only rollback.

**How to apply:** Operational stock follows eligible received FOC on the destination SKU. Duplicate receipt reviews are SKU-specific and must be rechecked at the target; do not transfer unrelated paid forecasts or clearance records.

FOC matching requires name, weight and packaging together, even when an explicit SKU ID is provided. Preserve the original pasted identity text after normalization-based matching; never silently rewrite it to the selected SKU.

**Why:** Canonicalizing a conflicting explicit-ID entry destroys evidence of the intended original packaging and makes historical wrong-SKU loads impossible to certify from the saved record alone.

**How to apply:** Reject conflicting or missing identity fields as unmatched, with no packaging-blind fallback. Manual selection supplies the registered identity; past records must only be investigated read-only, never auto-reassigned.

The user's Libya June 2026 source expectations are Double Apple 50g Old, Mint 50g Old and Mint 1kg New. The September–December 2026 PO FOC source is all New packaging.

**Why:** The user explicitly distinguished the earlier June load from the later PO load.

**How to apply:** Use these as investigation checks, not permission to move records or infer missing source evidence.
