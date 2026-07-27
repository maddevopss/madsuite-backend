BEGIN;
CREATE TABLE IF NOT EXISTS sst_incident_investigations (
 id BIGSERIAL PRIMARY KEY, organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
 incident_id BIGINT NOT NULL REFERENCES sst_incidents(id) ON DELETE CASCADE,
 lead_user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK(status IN ('open','collecting','analysis','review','closed','cancelled')),
 immediate_causes JSONB NOT NULL DEFAULT '[]'::jsonb, root_causes JSONB NOT NULL DEFAULT '[]'::jsonb,
 witness_statements JSONB NOT NULL DEFAULT '[]'::jsonb, evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
 findings TEXT, reviewed_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL, reviewed_at TIMESTAMPTZ,
 closed_at TIMESTAMPTZ, idempotency_key VARCHAR(180) NOT NULL,
 UNIQUE(organisation_id,idempotency_key), UNIQUE(organisation_id,incident_id)
);
CREATE TABLE IF NOT EXISTS sst_training_assignments (
 id BIGSERIAL PRIMARY KEY, organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
 employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
 competency_id BIGINT REFERENCES hr_competencies(id) ON DELETE SET NULL,
 training_code VARCHAR(100) NOT NULL, title VARCHAR(180) NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','in_progress','completed','expired','waived','cancelled')),
 assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), due_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
 score NUMERIC(5,2), evidence JSONB NOT NULL DEFAULT '[]'::jsonb, idempotency_key VARCHAR(180) NOT NULL,
 UNIQUE(organisation_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS sst_inspection_closures (
 id BIGSERIAL PRIMARY KEY, organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
 inspection_id BIGINT NOT NULL REFERENCES sst_inspections(id) ON DELETE CASCADE,
 completed_checklist JSONB NOT NULL DEFAULT '[]'::jsonb, findings JSONB NOT NULL DEFAULT '[]'::jsonb,
 corrective_action_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
 result VARCHAR(20) NOT NULL CHECK(result IN ('pass','conditional','fail')),
 completed_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL, completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 approved_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL, approved_at TIMESTAMPTZ,
 idempotency_key VARCHAR(180) NOT NULL, UNIQUE(organisation_id,idempotency_key), UNIQUE(organisation_id,inspection_id)
);
ALTER TABLE sst_incident_investigations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_training_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sst_inspection_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY sst_investigations_org ON sst_incident_investigations USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
CREATE POLICY sst_training_org ON sst_training_assignments USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
CREATE POLICY sst_inspection_closures_org ON sst_inspection_closures USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
COMMIT;
