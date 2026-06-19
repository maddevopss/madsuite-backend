-- 032_expenses.sql

CREATE TABLE IF NOT EXISTS expenses (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  projet_id INTEGER REFERENCES projets(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  description TEXT,
  distance DECIMAL(10, 2),
  rate_per_unit DECIMAL(10, 2),
  is_billable BOOLEAN DEFAULT TRUE,
  is_billed BOOLEAN DEFAULT FALSE,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  
  CONSTRAINT uq_expenses_id_org UNIQUE (id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_projet_id ON expenses(projet_id);
CREATE INDEX IF NOT EXISTS idx_expenses_org_id ON expenses(organisation_id);

DROP TRIGGER IF EXISTS trg_expenses_updated_at ON expenses;
CREATE TRIGGER trg_expenses_updated_at
BEFORE UPDATE ON expenses
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();
