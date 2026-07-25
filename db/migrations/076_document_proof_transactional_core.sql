BEGIN;

CREATE TABLE IF NOT EXISTS document_records (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_number TEXT NOT NULL,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'internal',
  status TEXT NOT NULL DEFAULT 'draft',
  owner_user_id BIGINT,
  retention_until DATE,
  legal_hold BOOLEAN NOT NULL DEFAULT FALSE,
  current_version_id BIGINT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, document_number)
);

CREATE TABLE IF NOT EXISTS document_versions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES document_records(id),
  version TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size >= 0),
  checksum_sha256 TEXT NOT NULL,
  source TEXT NOT NULL,
  effective_from DATE,
  supersedes_version_id BIGINT REFERENCES document_versions(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, document_id, version),
  UNIQUE (organisation_id, checksum_sha256)
);

ALTER TABLE document_records
  ADD CONSTRAINT document_records_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES document_versions(id);

CREATE TABLE IF NOT EXISTS document_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES document_records(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT 'evidence_for',
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, document_id, aggregate_type, aggregate_id, relation)
);

CREATE TABLE IF NOT EXISTS document_custody_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES document_records(id),
  version_id BIGINT REFERENCES document_versions(id),
  action TEXT NOT NULL,
  actor_user_id BIGINT,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ct_mad_transaction_id TEXT,
  correlation_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_attestations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES document_records(id),
  version_id BIGINT NOT NULL REFERENCES document_versions(id),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  attestation_type TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  attested_by BIGINT,
  attested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_document_records_org_status ON document_records(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_document_versions_org_document ON document_versions(organisation_id, document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_links_target ON document_links(organisation_id, aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_document_retention ON document_records(organisation_id, retention_until) WHERE retention_until IS NOT NULL;

COMMIT;
