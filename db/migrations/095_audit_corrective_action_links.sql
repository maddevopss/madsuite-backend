BEGIN;
CREATE TABLE IF NOT EXISTS audit_corrective_action_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  finding_id BIGINT NOT NULL REFERENCES internal_audit_findings(id),
  target_type TEXT NOT NULL,
  target_id BIGINT NOT NULL,
  verification_role TEXT NOT NULL DEFAULT 'independent_review',
  rationale TEXT NOT NULL,
  created_by BIGINT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, finding_id, target_type, target_id),
  UNIQUE (organisation_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_audit_corrective_links_finding ON audit_corrective_action_links(organisation_id, finding_id);
CREATE INDEX IF NOT EXISTS idx_audit_corrective_links_target ON audit_corrective_action_links(organisation_id, target_type, target_id);
COMMIT;
