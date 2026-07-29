ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(40);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency_code VARCHAR(3) NOT NULL DEFAULT 'CAD';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS default_expense_account_id BIGINT REFERENCES accounting_accounts(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS credit_limit_cents BIGINT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_code_uidx ON suppliers (organisation_id, supplier_code) WHERE supplier_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  role VARCHAR(120), email VARCHAR(255), phone VARCHAR(40),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_bill_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_bill_id BIGINT NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit_cost_cents BIGINT NOT NULL DEFAULT 0,
  tax_cents BIGINT NOT NULL DEFAULT 0,
  expense_account_id BIGINT REFERENCES accounting_accounts(id),
  purchase_order_id BIGINT,
  receipt_reference VARCHAR(80)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  payment_date DATE NOT NULL,
  method VARCHAR(24) NOT NULL,
  reference VARCHAR(120),
  idempotency_key VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_payment_id BIGINT NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
  supplier_bill_id BIGINT NOT NULL REFERENCES supplier_bills(id),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  UNIQUE (supplier_payment_id, supplier_bill_id)
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_contacts','supplier_bill_lines','supplier_payments','supplier_payment_allocations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', t);
    EXECUTE format('CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int)', t);
  END LOOP;
END $$;