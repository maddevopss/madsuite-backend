BEGIN;
CREATE TABLE IF NOT EXISTS document_evidence_references (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  document_id BIGINT NOT NULL REFERENCES governed_documents(id),
  version_id BIGINT REFERENCES governed_document_versions(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id BIGINT NOT NULL,
  evidence_role TEXT NOT NULL DEFAULT 'supporting_evidence',
  rationale TEXT,
  created_by BIGINT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, document_id, version_id, aggregate_type, aggregate_id, evidence_role),
  UNIQUE (organisation_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_document_evidence_aggregate ON document_evidence_references(organisation_id, aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_document_evidence_document ON document_evidence_references(organisation_id, document_id, version_id);
COMMIT;
