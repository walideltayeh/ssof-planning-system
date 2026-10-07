---
name: Planned FOC basis
description: User-confirmed scope and physical-versus-commercial meaning of monthly free product
---

Monthly FOC is planned free product for Libya and Syria only. Include FOC defaults on, but an entry defaults to Received No and must not affect arrivals, closing stock, cover or stock projections until explicitly received. A received date sets the landing month; without a date use the plan month. Paid sell-out (IMS), sales targets and commercial value never increase with giveaways. Production planning can still show the scheduled free product separately.

**Why:** The user corrected the original planned-only interpretation to require an explicit received status, while keeping unreceived FOC out of every stock and cover calculation.

**How to apply:** Keep a separate receipt layer that tracker/clearance replacement cannot erase. Recheck similar existing inbound before adding it; an administrator must resolve possible duplicates explicitly, with visible warnings and audit actor/time. Turning Received back to No removes the exact additive receipt. Carry the country-specific inclusion switch through stock views, projections and exports. Missing FOC is not set, not zero; distinguish complete totals from entered-only subtotals. Administration is country-specific, and viewers cannot edit.

Forecast Production is the primary paired ordered/FOC editing surface for Libya and Syria. Keep the Analysis FOC section unchanged, and leave Lebanon/KSA's Forecast presentation unchanged.

**Why:** The user explicitly requested in-place paired rows without duplicating storage or changing the other countries.

**How to apply:** Reuse the same FOC ledger and country inclusion setting on all surfaces. Excel round-trips may preserve existing duplicate decisions, but must never treat spreadsheet metadata as a new duplicate approval.
