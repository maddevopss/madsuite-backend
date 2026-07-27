-- MADSuite — approbations, échéanciers et lots de paiement fournisseurs

CREATE TABLE IF NOT EXISTS supplier_approval_policies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80),
  minimum_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  maximum_amount NUMERIC(14,2),
  required_approvals INTEGER NOT NULL DEFAULT 1 CHECK (required_approvals > 0),
  require_distinct_requester BOOLEAN NOT NULL DEFAULT TRUE,
  require_distinct_payer BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,name)
);

CREATE TABLE IF NOT EXISTS supplier_bill_approvals (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_bill_id BIGINT NOT NULL,
  policy_id BIGINT,
  sequence_number INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by INTEGER REFERENCES utilisateurs(id),
  decided_by INTEGER REFERENCES utilisateurs(id),
  decision_reason TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  idempotency_key VARCHAR(160),
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,idempotency_key),
  FOREIGN KEY (organisation_id,supplier_bill_id) REFERENCES supplier_bills(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,policy_id) REFERENCES supplier_approval_policies(organisation_id,id)
);

CREATE TABLE IF NOT EXISTS supplier_payment_batches (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  batch_number VARCHAR(80) NOT NULL,
  scheduled_for DATE NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','approved','processing','completed','failed','cancelled')),
  gross_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  withholding_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  prepared_by INTEGER REFERENCES utilisateurs(id),
  approved_by INTEGER REFERENCES utilisateurs(id),
  executed_by INTEGER REFERENCES utilisateurs(id),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,batch_number), UNIQUE (organisation_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS supplier_payment_batch_items (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  payment_batch_id BIGINT NOT NULL,
  supplier_bill_id BIGINT NOT NULL,
  requested_amount NUMERIC(14,2) NOT NULL CHECK (requested_amount > 0),
  early_payment_discount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (early_payment_discount >= 0),
  withholding_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (withholding_amount >= 0),
  payable_amount NUMERIC(14,2) NOT NULL CHECK (payable_amount >= 0),
  payment_method VARCHAR(40),
  payment_reference VARCHAR(160),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,payment_batch_id,supplier_bill_id),
  FOREIGN KEY (organisation_id,payment_batch_id) REFERENCES supplier_payment_batches(organisation_id,id) ON DELETE CASCADE,
  FOREIGN KEY (organisation_id,supplier_bill_id) REFERENCES supplier_bills(organisation_id,id)
);

ALTER TABLE supplier_approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_bill_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_approval_policies_org ON supplier_approval_policies USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY supplier_bill_approvals_org ON supplier_bill_approvals USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY supplier_payment_batches_org ON supplier_payment_batches USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY supplier_payment_batch_items_org ON supplier_payment_batch_items USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
