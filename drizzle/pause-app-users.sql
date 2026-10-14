-- Apply to development through the managed database schema workflow.
-- Publish applies the corresponding production schema diff.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS "isPaused" boolean NOT NULL DEFAULT false;
