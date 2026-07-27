BEGIN;
CREATE TABLE IF NOT EXISTS supplier_qualifications (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL,
  qualification_type VARCHAR(32) NOT NULL CHECK (qualification_type IN ('initial','renewal','exception')),
  financial_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (financial_score BETWEEN 0 AND 100),
  compliance_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (compliance_score BETWEEN 0 AND 100),
  operational_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (operational_score BETWEEN 0 AND 100),
  risk_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','conditional','rejected','expired')),
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  valid_until DATE,
  reviewed_by BIGINT,
  reviewed_at TIMESTAMPTZ,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,idempotency_key),
  FOREIGN KEY (organisation_id,supplier_id) REFERENCES suppliers(organisation_id,id) ON DELETE CASCADE
);
ALTER TABLE supplier_qualifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_qualifications_org ON supplier_qualifications USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
COMMIT;