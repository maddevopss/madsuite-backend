-- MADSuite — rapprochement fournisseur à deux ou trois pièces

ALTER TABLE supplier_bills
  ADD COLUMN IF NOT EXISTS purchase_order_id BIGINT,
  ADD COLUMN IF NOT EXISTS receipt_id BIGINT,
  ADD COLUMN IF NOT EXISTS matching_status VARCHAR(24) NOT NULL DEFAULT 'unmatched',
  ADD COLUMN IF NOT EXISTS matching_mode VARCHAR(16) NOT NULL DEFAULT 'three_way',
  ADD COLUMN IF NOT EXISTS matching_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(160);

-- Les clés étrangères composites créées plus bas exigent que la paire
-- (organisation_id, id) soit unique avant la création des tables dépendantes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'supplier_bills'::regclass
      AND conname = 'uq_supplier_bills_org_id'
  ) THEN
    ALTER TABLE supplier_bills
      ADD CONSTRAINT uq_supplier_bills_org_id UNIQUE (organisation_id, id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bills_org_idempotency
  ON supplier_bills (organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_bill_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_bill_id BIGINT NOT NULL,
  purchase_order_line_id BIGINT,
  receipt_line_id BIGINT,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,4) NOT NULL CHECK (unit_price >= 0),
  tax_rate NUMERIC(8,6) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  subtotal NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total NUMERIC(14,2) NOT NULL CHECK (tax_total >= 0),
  total NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, supplier_bill_id)
    REFERENCES supplier_bills (organisation_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_matching_policies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  matching_mode VARCHAR(16) NOT NULL DEFAULT 'three_way' CHECK (matching_mode IN ('two_way','three_way')),
  price_tolerance_percent NUMERIC(8,4) NOT NULL DEFAULT 2,
  quantity_tolerance_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
  tax_tolerance_amount NUMERIC(14,2) NOT NULL DEFAULT 0.05,
  auto_approve_within_tolerance BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_matching_policy_default
  ON supplier_matching_policies (organisation_id)
  WHERE is_default AND is_active;

CREATE TABLE IF NOT EXISTS supplier_matching_exceptions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_bill_id BIGINT NOT NULL,
  supplier_bill_line_id BIGINT,
  exception_type VARCHAR(32) NOT NULL CHECK (exception_type IN ('missing_order','missing_receipt','price','quantity','tax','duplicate','other')),
  expected_value NUMERIC(16,4),
  actual_value NUMERIC(16,4),
  variance_value NUMERIC(16,4),
  variance_percent NUMERIC(12,6),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','corrected','rejected')),
  explanation TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  resolved_by INTEGER REFERENCES utilisateurs(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  FOREIGN KEY (organisation_id, supplier_bill_id)
    REFERENCES supplier_bills (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, supplier_bill_line_id)
    REFERENCES supplier_bill_lines (organisation_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_matching_runs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_bill_id BIGINT NOT NULL,
  policy_id BIGINT,
  result_status VARCHAR(24) NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(160) NOT NULL,
  executed_by INTEGER REFERENCES utilisateurs(id),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, id),
  UNIQUE (organisation_id, idempotency_key),
  FOREIGN KEY (organisation_id, supplier_bill_id)
    REFERENCES supplier_bills (organisation_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id, policy_id)
    REFERENCES supplier_matching_policies (organisation_id, id)
);

ALTER TABLE supplier_bill_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_matching_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_matching_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_matching_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_bill_lines_org_isolation ON supplier_bill_lines
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY supplier_matching_policies_org_isolation ON supplier_matching_policies
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY supplier_matching_exceptions_org_isolation ON supplier_matching_exceptions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
CREATE POLICY supplier_matching_runs_org_isolation ON supplier_matching_runs
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);
