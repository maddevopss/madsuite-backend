-- Migration 013: audit log metier pour actions sensibles

CREATE TABLE IF NOT EXISTS business_audit_logs (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id INTEGER,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_audit_logs_org_created
ON business_audit_logs(organisation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_audit_logs_entity
ON business_audit_logs(entity_type, entity_id);

