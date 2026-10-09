---
name: Planned FOC basis
description: User-confirmed scope and physical-versus-commercial meaning of monthly free product
---

Monthly FOC is planned free product for Libya and Syria only. Include FOC defaults on, but an entry defaults to Received No and must not affect warehouse receipts, closing stock, cover or stock projections until explicitly received. Received is Yes/No only: Yes counts in its own planning month; No adds nothing. Do not reintroduce received dates, even in storage. Paid sell-out (IMS), sales targets and commercial value never increase with giveaways.

**Why:** The user explicitly corrected the receipt model to "just Received or no, no need for receipt date."

**How to apply:** Keep a separate receipt layer that tracker/clearance replacement cannot erase. Recheck similar existing inbound before adding it; an administrator must resolve possible duplicates explicitly, with visible warnings and audit actor/time. Turning Received back to No removes the exact additive receipt. Carry the country-specific inclusion switch through stock views, projections and exports. Missing FOC remains distinct from explicit zero internally; empty grid cells are blank, with no dashes or placeholder wording. Administration is country-specific, and viewers cannot edit.

For Syria, Production and FOC are both physically produced and should both be included in the quantity expected to arrive. This is distinct from confirming warehouse receipt.

**Why:** The user explicitly stated that both categories are produced and both should arrive.

**How to apply:** Distinguish combined physical batch quantities from received stock. Warehouse Received and the commercial/stock Include FOC selection must not hide physically expected FOC in Syria Arrival. Do not infer paid actual production from a FOC-only entry, and do not count FOC twice when it is already included in a production or clearance quantity.

All these numbers must link to the FG pages. Syria's physical Production figure uses the same positive manual actual, entered weekly production, then forecast priority as Arrival, plus FOC. Keep paid-only editing separate from the combined display. Warehouse arrivals follow clearance months and eligible FOC receipts, not production months.

**Why:** The user asked to make sure all numbers are linked to FG. Physical production and received stock are different quantities, but must agree on their underlying inputs.

**How to apply:** Preserve independent received FOC when tracker records are replaced. A possible combined-batch duplicate needs explicit review, not automatic stock addition; do not treat unrelated tracker totals above the batch's physical range as proof that separate FOC was already included.

Forecast Production is the only dedicated FOC surface for Libya and Syria. Retain the pre-FOC compact spreadsheet appearance, original type scale and dark red accent. FOC sub-rows appear only for SKUs with positive FOC quantities in the displayed periods and use the same compact row height. No standalone FOC section in Analysis, its slide order, PDF or Excel; keep Include FOC and its effects on arrivals, stock and derived totals. Do not introduce FOC in Lebanon/KSA.

**Why:** The user reversed the tall ordered-row hierarchy and oversized totals, explicitly asking for the pre-FOC spreadsheet design rather than new styling.

**How to apply:** Reuse the same FOC ledger and country inclusion setting on all surfaces. Excel round-trips may preserve existing duplicate decisions, but must never treat spreadsheet metadata as a new duplicate approval.

Forecast's primary figure must follow Include FOC. Do not repeat Ordered/FOC/Combined stacks or duplicate the FOC quantity under the main number when the FOC sub-row already supplies it. Totals are only slightly larger/heavier than data rows, with Grand Total strongest but restrained. All frozen panels and their row backgrounds must remain completely opaque, including excluded rows. Display whole quantities consistently in the active unit with en-US separators; keep exact values on hover and in storage/edits.

**Why:** The user repeated that the grid was unreadable, especially when scrolling toward totals, and explicitly required zero transparency.

**How to apply:** Preserve the selected-basis display versus paid-only editing distinction. Keep headers frozen and totals pinned inside the grid. Preserve first-time FOC entry through an explicit admin editing action without permanent empty sub-rows. Show target-week badges only on hover/focus. Verify density and both scroll directions at laptop width across all units, including long names and large numbers.

Do not display purchase-order reference documents or the Domestic / Export split on Forecast Production, in any country. Keep the load traceable through its existing Audit Trail entry and Version history snapshot instead.

**Why:** The user explicitly reversed the earlier instruction to keep these references visible on this page.

**How to apply:** Remove page-only reference UI and code, not audit records, saved versions, or the underlying imported quantities.
