-- 030_estimates.sql

CREATE TABLE IF NOT EXISTS estimates (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  estimate_number VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'invoiced')),
  issue_date DATE,
  valid_until DATE,
  subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_estimates_id_org
    UNIQUE (id, organisation_id),

  CONSTRAINT uq_estimates_number_org
    UNIQUE (organisation_id, estimate_number)
);

CREATE TABLE IF NOT EXISTS estimate_items (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  description TEXT,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_rate DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_estimate_items_id_org
    UNIQUE (id, organisation_id)
);

DROP TRIGGER IF EXISTS trg_estimates_updated_at ON estimates;
CREATE TRIGGER trg_estimates_updated_at
BEFORE UPDATE ON estimates
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_estimates_org_status
ON estimates(organisation_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimates_client_id
ON estimates(client_id);

CREATE INDEX IF NOT EXISTS idx_estimate_items_estimate_id
ON estimate_items(estimate_id);
