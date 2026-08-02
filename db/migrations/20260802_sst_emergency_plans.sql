BEGIN;

-- Mandat SST : "plans de mesures d'urgence" et "exercices d'urgence".
-- Aucune table existante ne couvre ce besoin (074_sst_transactional_core.sql
-- ne contient que hazards/incidents/inspections/corrective_actions/ppe).
-- Nouvelle entité, aucun orphelin à câbler.
CREATE TABLE IF NOT EXISTS sst_emergency_plans (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  plan_code VARCHAR(40) NOT NULL,
  scenario_type VARCHAR(60) NOT NULL,
  title VARCHAR(200) NOT NULL,
  procedure TEXT NOT NULL,
  assembly_point VARCHAR(200),
  responsible_employee_id BIGINT REFERENCES hr_employees(id) ON DELETE SET NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  review_due_at DATE,
  last_reviewed_at TIMESTAMPTZ,
  last_drill_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ct_mad_transaction_id TEXT,
  correlation_id TEXT,
  idempotency_key VARCHAR(180) NOT NULL,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key),
  UNIQUE (organisation_id, plan_code)
);

ALTER TABLE sst_emergency_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_emergency_plans_org ON sst_emergency_plans;
CREATE POLICY sst_emergency_plans_org ON sst_emergency_plans
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

CREATE TABLE IF NOT EXISTS sst_emergency_drills (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  plan_id BIGINT NOT NULL REFERENCES sst_emergency_plans(id) ON DELETE CASCADE,
  conducted_at TIMESTAMPTZ NOT NULL,
  participants_count INTEGER,
  observations TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ct_mad_transaction_id TEXT,
  correlation_id TEXT,
  idempotency_key VARCHAR(180) NOT NULL,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

ALTER TABLE sst_emergency_drills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_emergency_drills_org ON sst_emergency_drills;
CREATE POLICY sst_emergency_drills_org ON sst_emergency_drills
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

CREATE INDEX IF NOT EXISTS idx_sst_emergency_plans_review_due ON sst_emergency_plans(organisation_id, review_due_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sst_emergency_drills_plan ON sst_emergency_drills(organisation_id, plan_id);

COMMIT;
