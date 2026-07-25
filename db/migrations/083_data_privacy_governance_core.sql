BEGIN;

CREATE TABLE IF NOT EXISTS privacy_processing_activities (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  activity_number TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  legal_basis TEXT NOT NULL,
  data_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject_categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  recipients JSONB NOT NULL DEFAULT '[]'::jsonb,
  retention_period_days INTEGER NOT NULL CHECK (retention_period_days > 0),
  owner_user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','suspended','retired')),
  next_review_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, activity_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS privacy_consents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  subject_reference TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('granted','withdrawn','expired')),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMPTZ,
  source TEXT NOT NULL,
  proof JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS privacy_subject_requests (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  request_number TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('access','rectification','deletion','portability','restriction','objection')),
  subject_reference TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ NOT NULL,
  owner_user_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','verified','in_progress','completed','refused','cancelled')),
  identity_verification JSONB NOT NULL DEFAULT '[]'::jsonb,
  response_summary TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  refusal_reason TEXT,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, request_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS privacy_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  incident_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  affected_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  affected_subjects_estimate INTEGER NOT NULL DEFAULT 0 CHECK (affected_subjects_estimate >= 0),
  owner_user_id BIGINT NOT NULL,
  containment_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  notification_required BOOLEAN,
  notification_decision_reason TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','contained','investigating','resolved','closed')),
  root_cause TEXT,
  lessons_learned TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, incident_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS privacy_retention_actions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  processing_activity_id BIGINT NOT NULL REFERENCES privacy_processing_activities(id),
  action_number TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('review','archive','anonymize','delete')),
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  result TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','completed','cancelled')),
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, action_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_privacy_processing_org_review ON privacy_processing_activities(organisation_id,status,next_review_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_org_due ON privacy_subject_requests(organisation_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_privacy_incidents_org_status ON privacy_incidents(organisation_id,status,detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_retention_org_due ON privacy_retention_actions(organisation_id,status,due_at);

COMMIT;
