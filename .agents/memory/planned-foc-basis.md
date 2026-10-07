---
name: Planned FOC basis
description: User-confirmed scope and physical-versus-commercial meaning of monthly free product
---

Monthly FOC is planned free product for Libya and Syria only. Include FOC defaults on, but an entry defaults to Received No and must not affect arrivals, closing stock, cover or stock projections until explicitly received. Received is Yes/No only: Yes counts in its own planning month; No adds nothing. Do not reintroduce received dates, even in storage. Paid sell-out (IMS), sales targets and commercial value never increase with giveaways.

**Why:** The user explicitly corrected the receipt model to "just Received or no, no need for receipt date."

**How to apply:** Keep a separate receipt layer that tracker/clearance replacement cannot erase. Recheck similar existing inbound before adding it; an administrator must resolve possible duplicates explicitly, with visible warnings and audit actor/time. Turning Received back to No removes the exact additive receipt. Carry the country-specific inclusion switch through stock views, projections and exports. Missing FOC remains distinct from explicit zero internally; show a dash, not placeholder wording. Administration is country-specific, and viewers cannot edit.

Forecast Production is the only dedicated FOC surface for Libya and Syria. Ordered rows must be larger and heavier than compact, muted FOC sub-rows. No standalone FOC section in Analysis, its slide order, PDF or Excel; keep Include FOC and its effects on arrivals, stock and derived totals. Do not introduce FOC in Lebanon/KSA.

**Why:** The user said the dedicated Analysis section belongs on Forecast Production and that Order must read first, not as two equal rows.

**How to apply:** Reuse the same FOC ledger and country inclusion setting on all surfaces. Excel round-trips may preserve existing duplicate decisions, but must never treat spreadsheet metadata as a new duplicate approval.

Forecast's primary figure must follow Include FOC. Do not repeat Ordered/FOC/Combined stacks. Show a tiny secondary FOC quantity only when positive, and keep the editable FOC sub-row compact. Larger totals must not increase the FOC row's type or height. All frozen panels and their row backgrounds must remain completely opaque, including excluded rows.

**Why:** The user repeated that the grid was unreadable, especially when scrolling toward totals, and explicitly required zero transparency.

**How to apply:** Preserve the selected-basis display versus paid-only editing distinction. Keep headers frozen, totals pinned inside the grid, and Grand Total largest. Verify both scroll directions at narrow laptop width across all units, including long names and large numbers.
