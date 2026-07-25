CREATE TABLE IF NOT EXISTS external_partners (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  partner_code TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  partner_type TEXT NOT NULL,
  registration_number TEXT,
  primary_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  relationship_owner_user_id BIGINT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'active',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, partner_code)
);

CREATE TABLE IF NOT EXISTS external_partner_agreements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  partner_id BIGINT NOT NULL REFERENCES external_partners(id),
  agreement_number TEXT NOT NULL,
  agreement_type TEXT NOT NULL,
  title TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  responsibilities JSONB NOT NULL DEFAULT '[]'::jsonb,
  obligations JSONB NOT NULL DEFAULT '[]'::jsonb,
  service_levels JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  status TEXT NOT NULL DEFAULT 'draft',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, agreement_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS external_partner_certifications (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  partner_id BIGINT NOT NULL REFERENCES external_partners(id),
  certification_type TEXT NOT NULL,
  certification_number TEXT,
  issued_by TEXT NOT NULL,
  issued_at DATE,
  expires_at DATE,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  verified_by_user_id BIGINT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_partner_assessments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  partner_id BIGINT NOT NULL REFERENCES external_partners(id),
  assessment_type TEXT NOT NULL,
  assessed_at TIMESTAMPTZ NOT NULL,
  assessed_by_user_id BIGINT NOT NULL,
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  score NUMERIC(8,2),
  risk_level TEXT NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS external_partner_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  partner_id BIGINT NOT NULL REFERENCES external_partners(id),
  occurred_at TIMESTAMPTZ NOT NULL,
  incident_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  responsible_user_id BIGINT NOT NULL,
  corrective_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'open',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_external_partners_org_status ON external_partners (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_external_partner_agreements_expiry ON external_partner_agreements (organisation_id, effective_to, status);
CREATE INDEX IF NOT EXISTS idx_external_partner_certifications_expiry ON external_partner_certifications (organisation_id, expires_at, verification_status);
CREATE INDEX IF NOT EXISTS idx_external_partner_incidents_status ON external_partner_incidents (organisation_id, status, occurred_at DESC);