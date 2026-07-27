BEGIN;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  location_id BIGINT REFERENCES inventory_locations(id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  reference_type TEXT NOT NULL,
  reference_id BIGINT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed','cancelled')),
  expires_at TIMESTAMPTZ,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_cycle_counts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  count_number TEXT NOT NULL,
  location_id BIGINT NOT NULL REFERENCES inventory_locations(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_progress','submitted','approved','posted','cancelled')),
  counted_by BIGINT,
  approved_by BIGINT,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  variance_value NUMERIC(14,2) NOT NULL DEFAULT 0,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, count_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_cycle_count_items (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  cycle_count_id BIGINT NOT NULL REFERENCES inventory_cycle_counts(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  expected_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  counted_quantity NUMERIC(14,3),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  variance_quantity NUMERIC(14,3) GENERATED ALWAYS AS (COALESCE(counted_quantity,0)-expected_quantity) STORED,
  variance_value NUMERIC(14,2) GENERATED ALWAYS AS ((COALESCE(counted_quantity,0)-expected_quantity)*unit_cost) STORED,
  notes TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (organisation_id, cycle_count_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  location_id BIGINT NOT NULL REFERENCES inventory_locations(id),
  lot_number TEXT NOT NULL,
  serial_number TEXT,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  received_at TIMESTAMPTZ,
  expires_at DATE,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','quarantined','expired','consumed','disposed')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, item_id, lot_number, COALESCE(serial_number,''))
);

CREATE TABLE IF NOT EXISTS inventory_status_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('reservation','cycle_count','lot','item')),
  aggregate_id BIGINT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_active ON inventory_reservations(organisation_id,item_id,status);
CREATE INDEX IF NOT EXISTS idx_inventory_cycle_counts_status ON inventory_cycle_counts(organisation_id,status,location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_lots_expiry ON inventory_lots(organisation_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_inventory_status_events_aggregate ON inventory_status_events(organisation_id,aggregate_type,aggregate_id,created_at DESC);

ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_cycle_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_cycle_count_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_reservations_org_isolation ON inventory_reservations;
CREATE POLICY inventory_reservations_org_isolation ON inventory_reservations USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS inventory_cycle_counts_org_isolation ON inventory_cycle_counts;
CREATE POLICY inventory_cycle_counts_org_isolation ON inventory_cycle_counts USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS inventory_cycle_count_items_org_isolation ON inventory_cycle_count_items;
CREATE POLICY inventory_cycle_count_items_org_isolation ON inventory_cycle_count_items USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS inventory_lots_org_isolation ON inventory_lots;
CREATE POLICY inventory_lots_org_isolation ON inventory_lots USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);
DROP POLICY IF EXISTS inventory_status_events_org_isolation ON inventory_status_events;
CREATE POLICY inventory_status_events_org_isolation ON inventory_status_events USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint) WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);

COMMIT;