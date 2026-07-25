CREATE TABLE IF NOT EXISTS governance_units (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  parent_unit_id BIGINT REFERENCES governance_units(id),
  unit_code TEXT NOT NULL,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  leader_user_id BIGINT,
  mandate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, unit_code)
);

CREATE TABLE IF NOT EXISTS governance_delegations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  delegation_number TEXT NOT NULL,
  delegator_user_id BIGINT NOT NULL,
  delegate_user_id BIGINT NOT NULL,
  authority_type TEXT NOT NULL,
  scope JSONB NOT NULL DEFAULT '[]'::jsonb,
  financial_limit NUMERIC(14,2),
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, delegation_number),
  UNIQUE (organisation_id, idempotency_key),
  CHECK (ends_at > starts_at),
  CHECK (delegator_user_id <> delegate_user_id)
);

CREATE TABLE IF NOT EXISTS governance_committees (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  committee_code TEXT NOT NULL,
  name TEXT NOT NULL,
  mandate TEXT NOT NULL,
  chair_user_id BIGINT NOT NULL,
  secretary_user_id BIGINT,
  quorum_required INTEGER NOT NULL CHECK (quorum_required > 0),
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, committee_code)
);

CREATE TABLE IF NOT EXISTS governance_meetings (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  committee_id BIGINT NOT NULL REFERENCES governance_committees(id),
  meeting_number TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
  agenda JSONB NOT NULL DEFAULT '[]'::jsonb,
  minutes TEXT,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  quorum_met BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'scheduled',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, meeting_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS governance_decisions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  meeting_id BIGINT REFERENCES governance_meetings(id),
  decision_number TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  context TEXT NOT NULL,
  analysis TEXT NOT NULL,
  decision_text TEXT NOT NULL,
  justification TEXT NOT NULL,
  impacts JSONB NOT NULL DEFAULT '[]'::jsonb,
  risks JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  author_user_id BIGINT NOT NULL,
  approver_user_id BIGINT,
  effective_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'draft',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, decision_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS governance_policies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  policy_number TEXT NOT NULL,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  content_reference TEXT NOT NULL,
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  effective_from DATE,
  review_due_at DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, policy_number, version),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS governance_conflicts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  declarant_user_id BIGINT NOT NULL,
  conflict_number TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT,
  description TEXT NOT NULL,
  mitigation TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'declared',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, conflict_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_governance_delegations_active ON governance_delegations (organisation_id, delegate_user_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_governance_decisions_status ON governance_decisions (organisation_id, status, effective_at);
CREATE INDEX IF NOT EXISTS idx_governance_policies_review ON governance_policies (organisation_id, status, review_due_at);
CREATE INDEX IF NOT EXISTS idx_governance_conflicts_subject ON governance_conflicts (organisation_id, subject_type, subject_id, status);