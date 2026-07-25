-- MADSuite — inventaire transactionnel complet

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS transaction_id VARCHAR(96),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS transfer_location_id BIGINT REFERENCES inventory_locations(id),
  ADD COLUMN IF NOT EXISTS accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_movement_idempotency
  ON inventory_movements (organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_balances (
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES inventory_locations(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  average_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  inventory_value NUMERIC(16,4) GENERATED ALWAYS AS (quantity * average_cost) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organisation_id, item_id, location_id),
  CHECK (quantity >= 0),
  CHECK (average_cost >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  transaction_id VARCHAR(96) NOT NULL,
  transaction_type VARCHAR(24) NOT NULL CHECK (transaction_type IN ('receipt','issue','adjustment','transfer','return')),
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  source_location_id BIGINT REFERENCES inventory_locations(id),
  destination_location_id BIGINT REFERENCES inventory_locations(id),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  total_cost NUMERIC(16,4) NOT NULL DEFAULT 0 CHECK (total_cost >= 0),
  reason TEXT,
  reference_type VARCHAR(40),
  reference_id VARCHAR(80),
  idempotency_key VARCHAR(160) NOT NULL,
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  created_by INTEGER REFERENCES utilisateurs(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, transaction_id),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_balances_item
  ON inventory_balances (organisation_id, item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item
  ON inventory_transactions (organisation_id, item_id, occurred_at DESC);

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organisation_isolation ON inventory_balances;
DROP POLICY IF EXISTS organisation_isolation ON inventory_transactions;
CREATE POLICY organisation_isolation ON inventory_balances
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int);
CREATE POLICY organisation_isolation ON inventory_transactions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::int);

INSERT INTO inventory_balances (organisation_id, item_id, location_id, quantity, average_cost)
SELECT organisation_id, item_id, location_id,
       GREATEST(COALESCE(SUM(quantity),0),0),
       CASE WHEN SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END) > 0
            THEN COALESCE(SUM(CASE WHEN quantity > 0 THEN quantity * unit_cost ELSE 0 END)
                 / NULLIF(SUM(CASE WHEN quantity > 0 THEN quantity ELSE 0 END),0),0)
            ELSE 0 END
FROM inventory_movements
GROUP BY organisation_id, item_id, location_id
ON CONFLICT (organisation_id, item_id, location_id) DO NOTHING;
