---
name: Excel workbook validity
description: ExcelJS can serialize an empty workbook successfully even though Excel rejects the download.
---

ExcelJS can produce XLSX bytes with valid ZIP/XML structure but zero worksheets; Microsoft Excel rejects such files as corrupted.

**Why:** Arrival export for international countries was missing from the export dispatch, so Libya downloaded a zero-sheet file without a server error.

**How to apply:** Export regression tests must assert that required worksheets exist after loading the generated buffer, not merely that serialization succeeds or bytes start with `PK`. Never stream a workbook with zero worksheets; unknown export options must fail explicitly.
