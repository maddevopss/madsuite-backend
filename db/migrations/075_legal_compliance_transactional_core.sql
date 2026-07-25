CREATE TABLE IF NOT EXISTS legal_obligations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  authority TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT,
  version TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  review_due_at DATE,
  applicability JSONB NOT NULL DEFAULT '{}'::jsonb,
  requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','superseded','retired')),
  source_checksum TEXT NOT NULL,
  supersedes_id BIGINT REFERENCES legal_obligations(id),
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code, version)
);

CREATE TABLE IF NOT EXISTS legal_contracts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  contract_number TEXT NOT NULL,
  title TEXT NOT NULL,
  contract_type TEXT NOT NULL,
  counterparty_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','signed','active','expired','terminated','cancelled')),
  starts_at DATE,
  ends_at DATE,
  renewal_type TEXT NOT NULL DEFAULT 'none' CHECK (renewal_type IN ('none','manual','automatic')),
  notice_days INTEGER,
  owner_user_id BIGINT,
  terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  signed_at TIMESTAMPTZ,
  terminated_at TIMESTAMPTZ,
  termination_reason TEXT,
  ct_mad_transaction_id TEXT,
  correlation_id UUID,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, contract_number)
);

CREATE TABLE IF NOT EXISTS legal_policies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','published','superseded','retired')),
  content JSONB NOT NULL,
  effective_from DATE,
  effective_to DATE,
  review_due_at DATE,
  owner_user_id BIGINT,
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  content_checksum TEXT NOT NULL,
  supersedes_id BIGINT REFERENCES legal_policies(id),
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code, version)
);

CREATE TABLE IF NOT EXISTS legal_policy_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  policy_id BIGINT NOT NULL REFERENCES legal_policies(id),
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  UNIQUE (organisation_id, policy_id, employee_id),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS legal_matters (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  matter_number TEXT NOT NULL,
  matter_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','negotiating','litigation','settled','closed','cancelled')),
  risk_level TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  owner_user_id BIGINT,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  closure_reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ct_mad_transaction_id TEXT,
  correlation_id UUID,
  created_by BIGINT,
  UNIQUE (organisation_id, matter_number)
);

CREATE TABLE IF NOT EXISTS legal_compliance_assessments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  obligation_id BIGINT NOT NULL REFERENCES legal_obligations(id),
  status TEXT NOT NULL CHECK (status IN ('unknown','not_applicable','non_compliant','partial','compliant')),
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_review_at TIMESTAMPTZ,
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessor_user_id BIGINT,
  source_snapshot JSONB NOT NULL,
  source_checksum TEXT NOT NULL,
  ct_mad_transaction_id TEXT,
  correlation_id UUID
);

CREATE INDEX IF NOT EXISTS idx_legal_obligations_review ON legal_obligations (organisation_id, review_due_at) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_legal_contracts_end ON legal_contracts (organisation_id, ends_at) WHERE status IN ('signed','active');
CREATE INDEX IF NOT EXISTS idx_legal_policies_review ON legal_policies (organisation_id, review_due_at) WHERE status='published';
CREATE INDEX IF NOT EXISTS idx_legal_matters_due ON legal_matters (organisation_id, due_at) WHERE status NOT IN ('closed','cancelled');
CREATE INDEX IF NOT EXISTS idx_legal_assessments_obligation ON legal_compliance_assessments (organisation_id, obligation_id, assessed_at DESC);