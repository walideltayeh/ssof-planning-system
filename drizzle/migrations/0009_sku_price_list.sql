-- Secondary supply-chain price list per SKU (idempotent).
-- Trade-tier prices are per mastercase (MC); finalRspPerPack is per pack.
-- Mirrors the runtime guard in server/startup-migration.ts so a fresh
-- environment that bootstraps from the migration files alone ends up with
-- the same shape.
ALTER TABLE skus ADD COLUMN IF NOT EXISTS "priceToWs" numeric(12,2);
ALTER TABLE skus ADD COLUMN IF NOT EXISTS "priceWsToSemiWs" numeric(12,2);
ALTER TABLE skus ADD COLUMN IF NOT EXISTS "priceSemiWsToRetail" numeric(12,2);
ALTER TABLE skus ADD COLUMN IF NOT EXISTS "finalRspPerPack" numeric(12,2);
