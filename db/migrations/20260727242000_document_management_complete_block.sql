BEGIN;
CREATE TABLE IF NOT EXISTS document_approvals (
 id BIGSERIAL PRIMARY KEY, organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
 document_id BIGINT NOT NULL REFERENCES document_records(id) ON DELETE CASCADE,
 version_id BIGINT NOT NULL REFERENCES document_versions(id) ON DELETE CASCADE,
 approver_user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired','cancelled')),
 decision_reason TEXT, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ,
 idempotency_key VARCHAR(180) NOT NULL, UNIQUE(organisation_id,idempotency_key),
 UNIQUE(organisation_id,version_id,approver_user_id)
);
CREATE TABLE IF NOT EXISTS document_access_events (
 id BIGSERIAL PRIMARY KEY, organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
 document_id BIGINT NOT NULL REFERENCES document_records(id) ON DELETE CASCADE,
 version_id BIGINT REFERENCES document_versions(id) ON DELETE SET NULL,
 actor_user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
 action VARCHAR(20) NOT NULL CHECK(action IN ('view','download','share','print','export','sign')),
 purpose TEXT, request_id VARCHAR(120), occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS document_disposition_cases (
 id BIGSERIAL PRIMARY KEY, organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
 document_id BIGINT NOT NULL REFERENCES document_records(id) ON DELETE CASCADE,
 disposition_type VARCHAR(20) NOT NULL CHECK(disposition_type IN ('destroy','archive','transfer','retain')),
 status VARCHAR(20) NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','review','approved','executed','blocked','cancelled')),
 legal_hold_detected BOOLEAN NOT NULL DEFAULT FALSE, retention_due_at DATE,
 rationale TEXT NOT NULL, evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
 approved_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ,
 executed_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL, executed_at TIMESTAMPTZ,
 destruction_certificate_hash VARCHAR(64), idempotency_key VARCHAR(180) NOT NULL,
 UNIQUE(organisation_id,idempotency_key), UNIQUE(organisation_id,document_id,status)
);
ALTER TABLE document_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_disposition_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_approvals_org ON document_approvals USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
CREATE POLICY document_access_events_org ON document_access_events USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
CREATE POLICY document_disposition_cases_org ON document_disposition_cases USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
COMMIT;
