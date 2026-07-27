BEGIN;

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS tracking_mode VARCHAR(20) NOT NULL DEFAULT 'quantity'
    CHECK (tracking_mode IN ('quantity','lot','serial')),
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER CHECK (shelf_life_days IS NULL OR shelf_life_days >= 0),
  ADD COLUMN IF NOT EXISTS expiry_warning_days INTEGER NOT NULL DEFAULT 30 CHECK (expiry_warning_days >= 0);

CREATE TABLE IF NOT EXISTS inventory_lots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  lot_number VARCHAR(120) NOT NULL,
  supplier_id BIGINT,
  procurement_receipt_id BIGINT,
  manufactured_at DATE,
  expires_at DATE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','quarantined','recalled','expired','depleted')),
  quarantine_reason TEXT,
  recall_reason TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,item_id,lot_number),
  FOREIGN KEY (organisation_id,item_id)
    REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,supplier_id)
    REFERENCES suppliers(organisation_id,id),
  FOREIGN KEY (organisation_id,procurement_receipt_id)
    REFERENCES procurement_receipts(organisation_id,id)
);

CREATE TABLE IF NOT EXISTS inventory_lot_balances (
  organisation_id BIGINT NOT NULL,
  lot_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  reserved_quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id,lot_id,location_id),
  FOREIGN KEY (organisation_id,lot_id)
    REFERENCES inventory_lots(organisation_id,id),
  FOREIGN KEY (organisation_id,item_id)
    REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id)
    REFERENCES inventory_locations(organisation_id,id)
);

CREATE TABLE IF NOT EXISTS inventory_serial_numbers (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  serial_number VARCHAR(160) NOT NULL,
  lot_id BIGINT,
  location_id BIGINT,
  procurement_receipt_id BIGINT,
  supplier_id BIGINT,
  unit_cost NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  manufactured_at DATE,
  expires_at DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'available'
    CHECK (status IN ('available','reserved','issued','quarantined','recalled','expired','returned')),
  reference_type VARCHAR(80),
  reference_id VARCHAR(120),
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,serial_number),
  FOREIGN KEY (organisation_id,item_id)
    REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,lot_id)
    REFERENCES inventory_lots(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id)
    REFERENCES inventory_locations(organisation_id,id),
  FOREIGN KEY (organisation_id,procurement_receipt_id)
    REFERENCES procurement_receipts(organisation_id,id),
  FOREIGN KEY (organisation_id,supplier_id)
    REFERENCES suppliers(organisation_id,id)
);

CREATE TABLE IF NOT EXISTS inventory_trace_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  lot_id BIGINT,
  serial_id BIGINT,
  location_id BIGINT,
  event_type VARCHAR(40) NOT NULL
    CHECK (event_type IN ('received','transferred','reserved','released','issued','returned','quarantined','released_from_quarantine','recalled','expired','adjusted')),
  quantity NUMERIC(18,3),
  reference_type VARCHAR(80),
  reference_id VARCHAR(120),
  reason TEXT,
  actor_user_id BIGINT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(180) NOT NULL,
  UNIQUE (organisation_id,idempotency_key),
  FOREIGN KEY (organisation_id,item_id)
    REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,lot_id)
    REFERENCES inventory_lots(organisation_id,id),
  FOREIGN KEY (organisation_id,serial_id)
    REFERENCES inventory_serial_numbers(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id)
    REFERENCES inventory_locations(organisation_id,id)
);

CREATE TABLE IF NOT EXISTS inventory_recalls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  recall_number VARCHAR(100) NOT NULL,
  item_id BIGINT NOT NULL,
  lot_id BIGINT,
  reason TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','contained','closed','cancelled')),
  opened_by BIGINT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contained_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,recall_number),
  FOREIGN KEY (organisation_id,item_id)
    REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,lot_id)
    REFERENCES inventory_lots(organisation_id,id)
);

CREATE INDEX IF NOT EXISTS inventory_lots_expiry_idx
  ON inventory_lots (organisation_id,status,expires_at)
  WHERE status IN ('available','quarantined');
CREATE INDEX IF NOT EXISTS inventory_lot_balances_available_idx
  ON inventory_lot_balances (organisation_id,item_id,location_id,lot_id)
  WHERE quantity > reserved_quantity;
CREATE INDEX IF NOT EXISTS inventory_serial_status_idx
  ON inventory_serial_numbers (organisation_id,item_id,status,location_id);
CREATE INDEX IF NOT EXISTS inventory_trace_lookup_idx
  ON inventory_trace_events (organisation_id,item_id,lot_id,serial_id,occurred_at DESC);

ALTER TABLE inventory_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_lot_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_serial_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_trace_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_recalls ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['inventory_lots','inventory_lot_balances','inventory_serial_numbers','inventory_trace_events','inventory_recalls']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_policy ON %I', table_name, table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant_policy ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true),'''')::BIGINT) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true),'''')::BIGINT)',
      table_name, table_name
    );
  END LOOP;
END $$;

COMMIT;
