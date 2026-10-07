-- Applied to development; managed production receives the schema through Publish.
-- There is deliberately no startup-time DDL.
CREATE TABLE IF NOT EXISTS foc_data (
  id SERIAL PRIMARY KEY,
  country country NOT NULL,
  "skuId" integer NOT NULL,
  "periodId" integer NOT NULL,
  value numeric(12,2),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT foc_data_cell_unique UNIQUE(country, "skuId", "periodId")
);
