BEGIN;

ALTER TABLE inventory_locations
  ADD COLUMN IF NOT EXISTS code varchar(40),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE inventory_locations
SET code = COALESCE(NULLIF(code, ''), 'LOC-' || id::text)
WHERE code IS NULL OR code = '';

CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_locations_org_code
  ON inventory_locations (organisation_id, code);

ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS weighted_average_cost numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS movement_group_id uuid,
  ADD COLUMN IF NOT EXISTS idempotency_key varchar(160),
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS accounting_entry_id bigint REFERENCES accounting_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_movement_id bigint REFERENCES inventory_movements(id),
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS ux_inventory_movements_org_idempotency
  ON inventory_movements (organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_inventory_movements_org_item_location_date
  ON inventory_movements (organisation_id, item_id, location_id, occurred_at, id);
CREATE INDEX IF NOT EXISTS ix_inventory_movements_group
  ON inventory_movements (organisation_id, movement_group_id)
  WHERE movement_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_balances (
  id bigserial PRIMARY KEY,
  organisation_id bigint NOT NULL,
  item_id bigint NOT NULL REFERENCES inventory_items(id),
  location_id bigint NOT NULL REFERENCES inventory_locations(id),
  quantity numeric(16,4) NOT NULL DEFAULT 0,
  weighted_average_cost numeric(14,4) NOT NULL DEFAULT 0,
  inventory_value numeric(16,2) NOT NULL DEFAULT 0,
  last_movement_id bigint REFERENCES inventory_movements(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, item_id, location_id)
);

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_balances_tenant_isolation ON inventory_balances;
CREATE POLICY inventory_balances_tenant_isolation ON inventory_balances
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint);

CREATE TABLE IF NOT EXISTS inventory_operation_log (
  id bigserial PRIMARY KEY,
  organisation_id bigint NOT NULL,
  transaction_id varchar(120) NOT NULL,
  correlation_id uuid NOT NULL,
  operation_type varchar(80) NOT NULL,
  movement_group_id uuid NOT NULL,
  idempotency_key varchar(160) NOT NULL,
  item_id bigint NOT NULL REFERENCES inventory_items(id),
  source_location_id bigint REFERENCES inventory_locations(id),
  destination_location_id bigint REFERENCES inventory_locations(id),
  quantity numeric(16,4) NOT NULL,
  unit_cost numeric(14,4),
  accounting_entry_id bigint REFERENCES accounting_entries(id),
  actor_user_id bigint,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, idempotency_key)
);

ALTER TABLE inventory_operation_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_operation_log_tenant_isolation ON inventory_operation_log;
CREATE POLICY inventory_operation_log_tenant_isolation ON inventory_operation_log
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint);

INSERT INTO accounting_accounts (organisation_id, code, name, account_type, normal_balance)
SELECT DISTINCT o.id, seed.code, seed.name, seed.account_type, seed.normal_balance
FROM organisations o
CROSS JOIN (VALUES
  ('1200', 'Inventaire', 'asset', 'debit'),
  ('5000', 'Coût des marchandises vendues', 'expense', 'debit'),
  ('4950', 'Gains sur ajustements d’inventaire', 'revenue', 'credit'),
  ('6950', 'Pertes sur ajustements d’inventaire', 'expense', 'debit')
) AS seed(code, name, account_type, normal_balance)
ON CONFLICT (organisation_id, code) DO NOTHING;

COMMIT;
