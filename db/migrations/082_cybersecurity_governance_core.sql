BEGIN;

CREATE TABLE IF NOT EXISTS cybersecurity_assets (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_number TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('application','database','device','network','identity','service','supplier','other')),
  owner_user_id BIGINT NOT NULL,
  confidentiality TEXT NOT NULL DEFAULT 'internal' CHECK (confidentiality IN ('public','internal','confidential','restricted')),
  integrity_requirement TEXT NOT NULL DEFAULT 'medium' CHECK (integrity_requirement IN ('low','medium','high','critical')),
  availability_requirement TEXT NOT NULL DEFAULT 'medium' CHECK (availability_requirement IN ('low','medium','high','critical')),
  criticality TEXT NOT NULL DEFAULT 'medium' CHECK (criticality IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','retired')),
  next_review_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, asset_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS cybersecurity_controls (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_id BIGINT REFERENCES cybersecurity_assets(id),
  control_number TEXT NOT NULL,
  control_family TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  implementation_status TEXT NOT NULL DEFAULT 'planned' CHECK (implementation_status IN ('planned','implemented','verified','ineffective','retired')),
  verification_frequency TEXT,
  last_verified_at TIMESTAMPTZ,
  next_verification_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  result TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, control_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS cybersecurity_vulnerabilities (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_id BIGINT REFERENCES cybersecurity_assets(id),
  vulnerability_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  source TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  owner_user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','triaged','in_remediation','mitigated','accepted','closed')),
  remediation_plan TEXT,
  acceptance_reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, vulnerability_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS cybersecurity_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  incident_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  occurred_at TIMESTAMPTZ NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','contained','eradicated','recovered','closed')),
  affected_assets JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  containment_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  root_cause TEXT,
  lessons_learned TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, incident_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS cybersecurity_access_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  review_number TEXT NOT NULL,
  scope TEXT NOT NULL,
  reviewer_user_id BIGINT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conclusion TEXT NOT NULL,
  exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  remediation_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_review_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, review_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS cybersecurity_exercises (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  exercise_number TEXT NOT NULL,
  exercise_type TEXT NOT NULL CHECK (exercise_type IN ('tabletop','technical','phishing','recovery','other')),
  scenario TEXT NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner_user_id BIGINT NOT NULL,
  result TEXT NOT NULL,
  conclusion TEXT NOT NULL,
  improvement_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, exercise_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cyber_assets_org_status_review ON cybersecurity_assets(organisation_id,status,next_review_at);
CREATE INDEX IF NOT EXISTS idx_cyber_controls_org_status_verify ON cybersecurity_controls(organisation_id,implementation_status,next_verification_at);
CREATE INDEX IF NOT EXISTS idx_cyber_vulns_org_status_due ON cybersecurity_vulnerabilities(organisation_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_cyber_incidents_org_status ON cybersecurity_incidents(organisation_id,status,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cyber_access_reviews_org_next ON cybersecurity_access_reviews(organisation_id,next_review_at);

COMMIT;
