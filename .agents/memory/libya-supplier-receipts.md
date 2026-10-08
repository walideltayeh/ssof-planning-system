---
name: Libya supplier receipt authority
description: Which source governs Libya's warehouse receipt quantities and dates, and how to treat reported transit without actual quantities.
---

The supplier's **All_Received_to_Warehouse** sheet is authoritative for Libya Arrival and Clearance. The workbook's Arrival and Clearance Events sheets are app exports, not independent supplier evidence.

**Why:** The user explicitly said the supplier data is correct and their received total through June production matches it.

**How to apply:** Compare quantities and receipt dates against the supplier detail, not the app exports. A receipt in a later calendar month can belong to earlier production; do not assume receipt month equals production month. Preserve legitimate repeated supplier lines rather than removing them as duplicates.

Supplier descriptions do not identify Old/New packaging or manufacture month. Preserve supported packaging totals and use invoice and exact batch-quantity evidence for allocation; ask when the allocation remains ambiguous.

**Why:** Guessing can move receipts to the wrong SKU or production month even when the grand total remains correct.

**How to apply:** Keep the distinction between supplier facts and inferred batch allocation explicit. A reported transit status without shipped quantities must not fabricate actual production or warehouse receipts.
