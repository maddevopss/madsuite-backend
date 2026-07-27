BEGIN;

-- Les clés étrangères composites protègent explicitement l'isolation par organisation.
-- Les tables historiques utilisaient seulement une clé primaire globale sur id; PostgreSQL
-- exige une clé candidate correspondant exactement aux colonnes référencées.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_organisation_id_id_uq
  ON inventory_items (organisation_id,id);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_organisation_id_id_uq
  ON inventory_locations (organisation_id,id);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','released','consumed','expired','cancelled')),
  reference_type VARCHAR(80) NOT NULL,
  reference_id VARCHAR(120) NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  expires_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_reservations_item_fk
    FOREIGN KEY (organisation_id,item_id)
    REFERENCES inventory_items(organisation_id,id),
  CONSTRAINT inventory_reservations_location_fk
    FOREIGN KEY (organisation_id,location_id)
    REFERENCES inventory_locations(organisation_id,id),
  CONSTRAINT inventory_reservations_idempotency_uq
    UNIQUE (organisation_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS inventory_reservations_active_idx
  ON inventory_reservations (organisation_id,item_id,location_id,status)
  WHERE status='active';

CREATE TABLE IF NOT EXISTS inventory_count_sessions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  code VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','counting','review','approved','cancelled')),
  freeze_movements BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_by BIGINT,
  submitted_by BIGINT,
  approved_by BIGINT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_count_sessions_location_fk
    FOREIGN KEY (organisation_id,location_id)
    REFERENCES inventory_locations(organisation_id,id),
  CONSTRAINT inventory_count_sessions_code_uq
    UNIQUE (organisation_id,code),
  CONSTRAINT inventory_count_sessions_org_id_uq
    UNIQUE (organisation_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_count_sessions_one_open_per_location
  ON inventory_count_sessions (organisation_id,location_id)
  WHERE status IN ('draft','counting','review');

CREATE TABLE IF NOT EXISTS inventory_count_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  session_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  expected_quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  counted_quantity NUMERIC(18,3),
  variance_quantity NUMERIC(18,3),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  variance_value NUMERIC(18,4),
  count_sequence INTEGER NOT NULL DEFAULT 1 CHECK (count_sequence > 0),
  counted_by BIGINT,
  counted_at TIMESTAMPTZ,
  note TEXT,
  adjustment_transaction_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inventory_count_lines_session_fk
    FOREIGN KEY (organisation_id,session_id)
    REFERENCES inventory_count_sessions(organisation_id,id) ON DELETE CASCADE,
  CONSTRAINT inventory_count_lines_item_fk
    FOREIGN KEY (organisation_id,item_id)
    REFERENCES inventory_items(organisation_id,id),
  CONSTRAINT inventory_count_lines_item_uq
    UNIQUE (organisation_id,session_id,item_id)
);

CREATE INDEX IF NOT EXISTS inventory_count_lines_session_idx
  ON inventory_count_lines (organisation_id,session_id,item_id);

ALTER TABLE inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_count_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_reservations_tenant_policy ON inventory_reservations;
CREATE POLICY inventory_reservations_tenant_policy ON inventory_reservations
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT);

DROP POLICY IF EXISTS inventory_count_sessions_tenant_policy ON inventory_count_sessions;
CREATE POLICY inventory_count_sessions_tenant_policy ON inventory_count_sessions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT);

DROP POLICY IF EXISTS inventory_count_lines_tenant_policy ON inventory_count_lines;
CREATE POLICY inventory_count_lines_tenant_policy ON inventory_count_lines
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::BIGINT);

COMMIT;
