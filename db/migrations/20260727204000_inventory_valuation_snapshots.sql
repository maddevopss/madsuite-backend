BEGIN;

CREATE TABLE IF NOT EXISTS inventory_valuation_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL,
  valuation_method VARCHAR(24) NOT NULL DEFAULT 'weighted_average' CHECK (valuation_method IN ('weighted_average','fifo','specific_identification')),
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  total_quantity NUMERIC(16,3) NOT NULL DEFAULT 0,
  total_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  location_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash VARCHAR(128) NOT NULL,
  generated_by INTEGER REFERENCES utilisateurs(id),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  UNIQUE (organisation_id,as_of_date,valuation_method,source_hash)
);

CREATE INDEX IF NOT EXISTS idx_inventory_valuation_snapshots_lookup ON inventory_valuation_snapshots(organisation_id,as_of_date DESC,valuation_method);
ALTER TABLE inventory_valuation_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_valuation_snapshots_org ON inventory_valuation_snapshots USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);

COMMIT;