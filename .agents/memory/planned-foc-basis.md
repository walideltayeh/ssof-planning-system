---
name: Planned FOC basis
description: User-confirmed scope and physical-versus-commercial meaning of monthly free product
---

Monthly FOC is free product for Libya and Syria only. Include FOC defaults on and entries default to Received No. For Libya, Received Yes adds an eligible, duplicate-checked warehouse receipt in its own planning month; No adds nothing. Syria uses the clearance-only rule below instead. Do not reintroduce FOC received dates, even in storage. Paid sell-out (IMS), sales targets and commercial value never increase with giveaways.

**Why:** The user explicitly corrected the receipt model to "just Received or no, no need for receipt date."

**How to apply:** Keep a separate receipt layer that tracker/clearance replacement cannot erase. Recheck similar existing inbound before adding it; an administrator must resolve possible duplicates explicitly, with visible warnings and audit actor/time. Turning Received back to No removes the exact additive receipt. Carry the country-specific inclusion switch through stock views, projections and exports. Missing FOC remains distinct from explicit zero internally; empty grid cells are blank, with no dashes or placeholder wording. Administration is country-specific, and viewers cannot edit.

For Syria, Received FOC joins Production in Full Production and Arrival's quantity to clear. Received No excludes that FOC from these physical quantities. Received Yes means available for clearance, not already in the warehouse.

**Why:** The user specified "Production 100, FOC 10, Full Production 110 … 110 to be cleared … if FOC is marked Received" and confirmed stock increases only when the 110 is cleared.

**How to apply:** Show separate Production, FOC and Full Production rows in Syria FG. Include only received recorded lines when a cell is partially received. Arrival uses that same Full Production. Warehouse arrivals, closing stock, cover and stock projections use actual clearance quantities only; the FOC switch never adds a separate Syria warehouse receipt. Clearing 110 counts 110 once, never 120. Do not fabricate paid production for FOC-only batches.

All these numbers must link to the FG pages. Syria's Production figure uses the same positive manual actual, entered weekly production, then forecast priority as Arrival. Full Production adds Received FOC. Keep paid-only editing separate from the combined display. Syria warehouse arrivals follow clearance months, not production months or the FOC Received switch.

**Why:** The user asked to make sure all numbers are linked to FG. Physical production and received stock are different quantities, but must agree on their underlying inputs.

**How to apply:** Preserve FOC records and their Received flags when tracker records are replaced. Syria requires no separate FOC stock addition or duplicate approval: its warehouse stock comes from clearance events. Libya's separate warehouse-receipt and duplicate-review rules remain unchanged.

Forecast Production is the only dedicated FOC surface for Libya and Syria. Retain the pre-FOC compact spreadsheet appearance, original type scale and dark red accent. FOC sub-rows appear only for SKUs with positive FOC quantities in the displayed periods and use the same compact row height. No standalone FOC section in Analysis, its slide order, PDF or Excel; keep Include FOC and its effects on arrivals, stock and derived totals. Do not introduce FOC in Lebanon/KSA.

**Why:** The user reversed the tall ordered-row hierarchy and oversized totals, explicitly asking for the pre-FOC spreadsheet design rather than new styling.

**How to apply:** Reuse the same FOC ledger and country inclusion setting on all surfaces. Excel round-trips may preserve existing duplicate decisions, but must never treat spreadsheet metadata as a new duplicate approval.

Forecast's primary figure must follow Include FOC. Do not repeat Ordered/FOC/Combined stacks or duplicate the FOC quantity under the main number when the FOC sub-row already supplies it. Totals are only slightly larger/heavier than data rows, with Grand Total strongest but restrained. All frozen panels and their row backgrounds must remain completely opaque, including excluded rows. Display whole quantities consistently in the active unit with en-US separators; keep exact values on hover and in storage/edits.

**Why:** The user repeated that the grid was unreadable, especially when scrolling toward totals, and explicitly required zero transparency.

**How to apply:** Preserve the selected-basis display versus paid-only editing distinction. Keep headers frozen and totals pinned inside the grid. Preserve first-time FOC entry through an explicit admin editing action without permanent empty sub-rows. Show target-week badges only on hover/focus. Verify density and both scroll directions at laptop width across all units, including long names and large numbers.

Do not display purchase-order reference documents or the Domestic / Export split on Forecast Production, in any country. Keep the load traceable through its existing Audit Trail entry and Version history snapshot instead.

**Why:** The user explicitly reversed the earlier instruction to keep these references visible on this page.

**How to apply:** Remove page-only reference UI and code, not audit records, saved versions, or the underlying imported quantities.
