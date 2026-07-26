BEGIN;

CREATE TABLE IF NOT EXISTS institutional_risk_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_id BIGINT NOT NULL REFERENCES enterprise_risks(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('cybersecurity_vulnerability','cybersecurity_incident','privacy_incident')),
  target_id BIGINT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('source','impact','treatment','monitoring')),
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, risk_id, target_type, target_id, relationship_type),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_institutional_risk_links_risk ON institutional_risk_links(organisation_id, risk_id);
CREATE INDEX IF NOT EXISTS idx_institutional_risk_links_target ON institutional_risk_links(organisation_id, target_type, target_id);

COMMIT;
