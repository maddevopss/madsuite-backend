-- Complète les tables d’inventaire déjà créées par 058_core_business_modules.sql.
-- Cette migration est additive et respecte les types BIGINT/INTEGER existants.

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(128),
  ADD COLUMN IF NOT EXISTS target_stock NUMERIC(14,3) NOT NULL DEFAULT 0;

ALTER TABLE inventory_locations
  ADD COLUMN IF NOT EXISTS address JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_items_barcode_unique
  ON inventory_items (organisation_id, barcode)
  WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_movements_lookup_idx
  ON inventory_movements (organisation_id, item_id, location_id, occurred_at);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organisation_isolation ON inventory_items;
CREATE POLICY organisation_isolation ON inventory_items
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int);

DROP POLICY IF EXISTS organisation_isolation ON inventory_locations;
CREATE POLICY organisation_isolation ON inventory_locations
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int);

DROP POLICY IF EXISTS organisation_isolation ON inventory_movements;
CREATE POLICY organisation_isolation ON inventory_movements
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int);
