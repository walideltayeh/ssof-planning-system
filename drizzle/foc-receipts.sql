-- Development schema record. Publish applies the managed production schema diff.
ALTER TABLE foc_data ADD COLUMN IF NOT EXISTS received boolean NOT NULL DEFAULT false;
ALTER TABLE foc_data ADD COLUMN IF NOT EXISTS "receivedDate" date;
ALTER TABLE foc_data ADD COLUMN IF NOT EXISTS "receiptDecision" varchar(16) NOT NULL DEFAULT 'pending';
ALTER TABLE foc_data ADD COLUMN IF NOT EXISTS "receiptReviewKey" text;
