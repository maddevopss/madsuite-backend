BEGIN;

CREATE TABLE IF NOT EXISTS enterprise_risks (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_number TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  source_type TEXT,
  source_id TEXT,
  owner_user_id BIGINT NOT NULL,
  likelihood SMALLINT NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 5),
  inherent_score SMALLINT NOT NULL CHECK (inherent_score BETWEEN 1 AND 25),
  appetite_threshold SMALLINT CHECK (appetite_threshold BETWEEN 1 AND 25),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assessed','treatment_required','accepted','monitoring','closed','cancelled')),
  next_review_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  closure_reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, risk_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_risk_assessments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_id BIGINT NOT NULL REFERENCES enterprise_risks(id),
  likelihood SMALLINT NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
  impact SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 5),
  inherent_score SMALLINT NOT NULL CHECK (inherent_score BETWEEN 1 AND 25),
  control_effectiveness SMALLINT NOT NULL DEFAULT 0 CHECK (control_effectiveness BETWEEN 0 AND 100),
  residual_score NUMERIC(6,2) NOT NULL CHECK (residual_score >= 0 AND residual_score <= 25),
  conclusion TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  assessed_by BIGINT,
  assessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_risk_controls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_id BIGINT NOT NULL REFERENCES enterprise_risks(id),
  control_number TEXT NOT NULL,
  objective TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  frequency TEXT,
  effectiveness SMALLINT NOT NULL DEFAULT 0 CHECK (effectiveness BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','ineffective','retired')),
  last_verified_at TIMESTAMPTZ,
  verification_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, control_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_risk_treatments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_id BIGINT NOT NULL REFERENCES enterprise_risks(id),
  treatment_number TEXT NOT NULL,
  strategy TEXT NOT NULL CHECK (strategy IN ('accept','reduce','transfer','avoid')),
  description TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','implemented','verified','closed','cancelled')),
  result TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, treatment_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_risk_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_id BIGINT NOT NULL REFERENCES enterprise_risks(id),
  review_number TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewer_user_id BIGINT NOT NULL,
  likelihood SMALLINT CHECK (likelihood BETWEEN 1 AND 5),
  impact SMALLINT CHECK (impact BETWEEN 1 AND 5),
  residual_score NUMERIC(6,2) CHECK (residual_score >= 0 AND residual_score <= 25),
  conclusion TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','closed')),
  next_review_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, review_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_risk_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_id BIGINT REFERENCES enterprise_risks(id),
  incident_number TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  impact_summary TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','contained','resolved','closed')),
  owner_user_id BIGINT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, incident_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_enterprise_risks_org_status_review ON enterprise_risks(organisation_id, status, next_review_at);
CREATE INDEX IF NOT EXISTS idx_enterprise_risk_assessments_org_risk ON enterprise_risk_assessments(organisation_id, risk_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_enterprise_risk_controls_org_status ON enterprise_risk_controls(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_enterprise_risk_treatments_org_status_due ON enterprise_risk_treatments(organisation_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_enterprise_risk_incidents_org_status ON enterprise_risk_incidents(organisation_id, status, occurred_at DESC);

COMMIT;
