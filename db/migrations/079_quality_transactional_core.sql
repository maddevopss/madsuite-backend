BEGIN;

CREATE TABLE IF NOT EXISTS quality_control_plans (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_reference TEXT,
  version TEXT NOT NULL,
  sampling_method TEXT,
  acceptance_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','retired')),
  effective_from DATE,
  review_due_at DATE,
  owner_user_id BIGINT,
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code, version),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS quality_inspections (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  inspection_number TEXT NOT NULL,
  plan_id BIGINT REFERENCES quality_control_plans(id),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  lot_number TEXT,
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  inspector_user_id BIGINT,
  sample_size NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (sample_size >= 0),
  accepted_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (accepted_quantity >= 0),
  rejected_quantity NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  result TEXT NOT NULL CHECK (result IN ('pending','accepted','conditionally_accepted','rejected')),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, inspection_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS quality_nonconformities (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  nonconformity_number TEXT NOT NULL,
  inspection_id BIGINT REFERENCES quality_inspections(id),
  source_type TEXT NOT NULL,
  source_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','contained','investigating','action_required','verified','closed','cancelled')),
  containment_action TEXT,
  root_cause TEXT,
  disposition TEXT,
  owner_user_id BIGINT,
  due_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  closure_reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, nonconformity_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS quality_corrective_actions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  action_number TEXT NOT NULL,
  nonconformity_id BIGINT NOT NULL REFERENCES quality_nonconformities(id),
  action_type TEXT NOT NULL CHECK (action_type IN ('correction','corrective','preventive')),
  description TEXT NOT NULL,
  owner_user_id BIGINT,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','implemented','effectiveness_verified','closed','cancelled')),
  implementation_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  effectiveness_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  effectiveness_result TEXT,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, action_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS quality_audits (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  audit_number TEXT NOT NULL,
  audit_type TEXT NOT NULL CHECK (audit_type IN ('internal','supplier','process','product','system')),
  scope TEXT NOT NULL,
  standard_reference TEXT,
  planned_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  lead_auditor_user_id BIGINT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','closed','cancelled')),
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  conclusion TEXT,
  reason TEXT,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, audit_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_quality_inspections_org_result ON quality_inspections(organisation_id, result);
CREATE INDEX IF NOT EXISTS idx_quality_nc_org_status_due ON quality_nonconformities(organisation_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_quality_actions_org_status_due ON quality_corrective_actions(organisation_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_quality_audits_org_status_planned ON quality_audits(organisation_id, status, planned_at);

COMMIT;
