BEGIN;

CREATE TABLE IF NOT EXISTS internal_audit_programs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  program_number TEXT NOT NULL,
  title TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  objectives TEXT NOT NULL,
  scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_basis JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','closed','cancelled')),
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, program_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS internal_audit_engagements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  program_id BIGINT REFERENCES internal_audit_programs(id),
  engagement_number TEXT NOT NULL,
  title TEXT NOT NULL,
  audit_type TEXT NOT NULL CHECK (audit_type IN ('process','compliance','financial','operational','cybersecurity','privacy','quality','supplier','special')),
  objective TEXT NOT NULL,
  scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  lead_auditor_user_id BIGINT NOT NULL,
  auditee_owner_user_id BIGINT NOT NULL,
  planned_start_at TIMESTAMPTZ,
  planned_end_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','reporting','completed','cancelled')),
  conclusion TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, engagement_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS internal_audit_findings (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  engagement_id BIGINT NOT NULL REFERENCES internal_audit_engagements(id),
  finding_number TEXT NOT NULL,
  classification TEXT NOT NULL CHECK (classification IN ('observation','opportunity','minor','major','critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  criterion TEXT NOT NULL,
  root_cause TEXT,
  owner_user_id BIGINT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','in_remediation','verification','closed','cancelled')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  closure_reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, finding_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS internal_audit_actions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  finding_id BIGINT NOT NULL REFERENCES internal_audit_findings(id),
  action_number TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','implemented','verified','closed','cancelled')),
  implementation_result TEXT,
  effectiveness_result TEXT,
  implementation_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, action_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS internal_audit_followups (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  engagement_id BIGINT NOT NULL REFERENCES internal_audit_engagements(id),
  followup_number TEXT NOT NULL,
  reviewer_user_id BIGINT NOT NULL,
  conclusion TEXT NOT NULL,
  residual_risk TEXT,
  next_followup_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','additional_action_required','closed')),
  idempotency_key TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, followup_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_internal_audit_engagements_org_status ON internal_audit_engagements(organisation_id,status,planned_start_at);
CREATE INDEX IF NOT EXISTS idx_internal_audit_findings_org_status_due ON internal_audit_findings(organisation_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_internal_audit_actions_org_status_due ON internal_audit_actions(organisation_id,status,due_at);

COMMIT;
