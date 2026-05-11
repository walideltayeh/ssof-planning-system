-- Rename revised_forecast_data → actual_production_data (idempotent).
-- This mirrors the runtime guard in server/startup-migration.ts so a fresh
-- environment that bootstraps from the migration files alone ends up with
-- the same shape.
DO $$
BEGIN
  IF to_regclass('public.revised_forecast_data') IS NOT NULL
     AND to_regclass('public.actual_production_data') IS NULL THEN
    EXECUTE 'ALTER TABLE revised_forecast_data RENAME TO actual_production_data';
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'revised_forecast_data_pkey') THEN
      EXECUTE 'ALTER INDEX revised_forecast_data_pkey RENAME TO actual_production_data_pkey';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'revised_forecast_data_sku_period_idx') THEN
      EXECUTE 'ALTER INDEX revised_forecast_data_sku_period_idx RENAME TO actual_production_data_sku_period_idx';
    END IF;
  END IF;
END
$$;
