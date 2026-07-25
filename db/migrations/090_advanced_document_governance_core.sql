CREATE TABLE IF NOT EXISTS document_classifications (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  classification_code TEXT NOT NULL,
  name TEXT NOT NULL,
  sensitivity_level TEXT NOT NULL DEFAULT 'internal',
  retention_years INTEGER,
  legal_hold_required BOOLEAN NOT NULL DEFAULT FALSE,
  owner_user_id BIGINT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, classification_code)
);

CREATE TABLE IF NOT EXISTS governed_documents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  classification_id BIGINT NOT NULL REFERENCES document_classifications(id),
  document_code TEXT NOT NULL,
  title TEXT NOT NULL,
  business_owner_user_id BIGINT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft',
  effective_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, document_code)
);

CREATE TABLE IF NOT EXISTS governed_document_versions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES governed_documents(id),
  version_number INTEGER NOT NULL,
  change_summary TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  storage_ref TEXT NOT NULL,
  prepared_by_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  approved_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, document_id, version_number)
);

CREATE TABLE IF NOT EXISTS document_retention_actions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES governed_documents(id),
  action_type TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  requested_by_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  executed_by_user_id BIGINT,
  executed_at TIMESTAMPTZ,
  reason TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS document_access_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES governed_documents(id),
  reviewed_by_user_id BIGINT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL,
  authorized_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_governed_documents_org_status ON governed_documents (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_document_retention_org_status ON document_retention_actions (organisation_id, status, scheduled_at);
