-- Development migration record. Publish applies the managed production diff.
-- Received FOC belongs to its own planning month, never a separate receipt date.
ALTER TABLE foc_data DROP COLUMN IF EXISTS "receivedDate";
