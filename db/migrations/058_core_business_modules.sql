-- MADSuite — fondations des grands modules métier
-- Comptabilité, fournisseurs, inventaire, paie, décisionnel et continuité cognitive.

CREATE TABLE IF NOT EXISTS accounting_accounts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  account_type VARCHAR(24) NOT NULL CHECK (account_type IN ('asset','liability','equity','revenue','expense')),
  normal_balance VARCHAR(6) NOT NULL CHECK (normal_balance IN ('debit','credit')),
  parent_id BIGINT REFERENCES accounting_accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code)
);

CREATE TABLE IF NOT EXISTS accounting_journals (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(24) NOT NULL,
  name VARCHAR(120) NOT NULL,
  journal_type VARCHAR(24) NOT NULL DEFAULT 'general',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code)
);

CREATE TABLE IF NOT EXISTS accounting_entries (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  journal_id BIGINT NOT NULL REFERENCES accounting_journals(id),
  entry_number VARCHAR(48) NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  source_type VARCHAR(40), source_id VARCHAR(80),
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  posted_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, entry_number)
);

CREATE TABLE IF NOT EXISTS accounting_entry_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  entry_id BIGINT NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounting_accounts(id),
  description TEXT,
  debit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  contact_name VARCHAR(160), email VARCHAR(255), phone VARCHAR(40),
  tax_number VARCHAR(80), payment_terms_days INTEGER NOT NULL DEFAULT 30,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_bills (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES suppliers(id),
  bill_number VARCHAR(80) NOT NULL,
  bill_date DATE NOT NULL, due_date DATE,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','partially_paid','paid','void')),
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, supplier_id, bill_number)
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  sku VARCHAR(64) NOT NULL, name VARCHAR(180) NOT NULL, description TEXT,
  unit VARCHAR(24) NOT NULL DEFAULT 'unité',
  cost NUMERIC(14,4) NOT NULL DEFAULT 0, sale_price NUMERIC(14,2) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(14,3) NOT NULL DEFAULT 0,
  asset_account_id BIGINT REFERENCES accounting_accounts(id),
  expense_account_id BIGINT REFERENCES accounting_accounts(id),
  revenue_account_id BIGINT REFERENCES accounting_accounts(id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, sku)
);

CREATE TABLE IF NOT EXISTS inventory_locations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL, name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (organisation_id, code)
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  location_id BIGINT NOT NULL REFERENCES inventory_locations(id),
  movement_type VARCHAR(24) NOT NULL CHECK (movement_type IN ('receipt','issue','adjustment','transfer_in','transfer_out','return')),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity <> 0),
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  reference_type VARCHAR(40), reference_id VARCHAR(80), note TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_by INTEGER REFERENCES utilisateurs(id)
);

CREATE TABLE IF NOT EXISTS payroll_employees (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id), employee_number VARCHAR(40) NOT NULL,
  legal_name VARCHAR(180) NOT NULL, hire_date DATE NOT NULL, termination_date DATE,
  pay_type VARCHAR(16) NOT NULL CHECK (pay_type IN ('hourly','salary')),
  hourly_rate NUMERIC(12,2), annual_salary NUMERIC(14,2),
  province VARCHAR(2) NOT NULL DEFAULT 'QC',
  tax_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, employee_number)
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_start DATE NOT NULL, period_end DATE NOT NULL, pay_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculated','approved','paid','void')),
  ruleset_version VARCHAR(40) NOT NULL,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payroll_run_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payroll_run_id BIGINT NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES payroll_employees(id),
  regular_hours NUMERIC(10,2) NOT NULL DEFAULT 0, overtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  gross_pay NUMERIC(14,2) NOT NULL DEFAULT 0, deductions JSONB NOT NULL DEFAULT '{}'::jsonb,
  employer_contributions JSONB NOT NULL DEFAULT '{}'::jsonb, net_pay NUMERIC(14,2) NOT NULL DEFAULT 0,
  calculation_trace JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organisation_id, payroll_run_id, employee_id)
);

CREATE TABLE IF NOT EXISTS decision_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  metrics JSONB NOT NULL, alerts JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, snapshot_date)
);

CREATE TABLE IF NOT EXISTS cognitive_continuity_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id),
  event_type VARCHAR(40) NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cognitive_assistance_recommendations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES utilisateurs(id),
  recommendation_type VARCHAR(40) NOT NULL,
  title VARCHAR(180) NOT NULL, explanation TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','accepted','dismissed','expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_accounting_lines_account ON accounting_entry_lines (organisation_id, account_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON inventory_movements (organisation_id, item_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_supplier_bills_due ON supplier_bills (organisation_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_period ON payroll_runs (organisation_id, period_end);
CREATE INDEX IF NOT EXISTS idx_cognitive_continuity_user ON cognitive_continuity_events (organisation_id, user_id, occurred_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounting_accounts','accounting_journals','accounting_entries','accounting_entry_lines',
    'suppliers','supplier_bills','inventory_items','inventory_locations','inventory_movements',
    'payroll_employees','payroll_runs','payroll_run_lines','decision_snapshots',
    'cognitive_continuity_events','cognitive_assistance_recommendations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int)', t
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_posted_accounting_entry_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'posted' THEN
    RAISE EXCEPTION 'Une écriture publiée est immuable; créez une écriture de renversement.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS accounting_entries_immutable_when_posted ON accounting_entries;
CREATE TRIGGER accounting_entries_immutable_when_posted BEFORE UPDATE OR DELETE ON accounting_entries
FOR EACH ROW EXECUTE FUNCTION prevent_posted_accounting_entry_mutation();
