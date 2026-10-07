-- Development schema change; publishing applies the managed production diff.
ALTER TABLE foc_data ADD COLUMN IF NOT EXISTS lines json NOT NULL DEFAULT '[]'::json;
