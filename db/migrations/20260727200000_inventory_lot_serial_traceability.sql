BEGIN;

CREATE TABLE IF NOT EXISTS inventory_lots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_number VARCHAR(96) NOT NULL,
  manufactured_at DATE,
  expires_at DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','quarantined','expired','consumed','recalled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,item_id,lot_number)
);

CREATE TABLE IF NOT EXISTS inventory_serials (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  lot_id BIGINT REFERENCES inventory_lots(id) ON DELETE SET NULL,
  serial_number VARCHAR(128) NOT NULL,
  location_id BIGINT REFERENCES inventory_locations(id),
  status VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (status IN ('available','reserved','issued','returned','quarantined','retired')),
  acquired_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organisation_id,serial_number)
);

CREATE TABLE IF NOT EXISTS inventory_trace_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  lot_id BIGINT REFERENCES inventory_lots(id),
  serial_id BIGINT REFERENCES inventory_serials(id),
  transaction_id BIGINT REFERENCES inventory_transactions(id),
  event_type VARCHAR(28) NOT NULL CHECK (event_type IN ('received','moved','reserved','issued','returned','quarantined','released','recalled','retired')),
  location_id BIGINT REFERENCES inventory_locations(id),
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by INTEGER REFERENCES utilisateurs(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_lots_expiry ON inventory_lots(organisation_id,expires_at,status);
CREATE INDEX IF NOT EXISTS idx_inventory_trace_lookup ON inventory_trace_events(organisation_id,item_id,occurred_at DESC);

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_serials ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_trace_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_lots_org ON inventory_lots USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY inventory_serials_org ON inventory_serials USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY inventory_trace_events_org ON inventory_trace_events USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);

COMMIT;