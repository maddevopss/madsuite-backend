BEGIN;

CREATE TABLE IF NOT EXISTS inventory_counts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES inventory_locations(id),
  count_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','submitted','approved','posted','cancelled')),
  blind_count BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_to INTEGER REFERENCES utilisateurs(id),
  submitted_by INTEGER REFERENCES utilisateurs(id),
  approved_by INTEGER REFERENCES utilisateurs(id),
  posted_by INTEGER REFERENCES utilisateurs(id),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  idempotency_key VARCHAR(160) NOT NULL,
  UNIQUE (organisation_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  count_id BIGINT NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  expected_quantity NUMERIC(14,3),
  counted_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (counted_quantity >= 0),
  variance_quantity NUMERIC(14,3) GENERATED ALWAYS AS (counted_quantity - COALESCE(expected_quantity,0)) STORED,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  note TEXT,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organisation_id,count_id,item_id)
);

ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_counts_org ON inventory_counts USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY inventory_count_lines_org ON inventory_count_lines USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);

COMMIT;