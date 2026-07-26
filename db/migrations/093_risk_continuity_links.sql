BEGIN;

CREATE TABLE IF NOT EXISTS enterprise_risk_continuity_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  risk_id BIGINT NOT NULL REFERENCES enterprise_risks(id),
  process_id BIGINT REFERENCES enterprise_business_processes(id),
  plan_id BIGINT REFERENCES enterprise_continuity_plans(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('threatens_process','mitigated_by_plan','triggered_plan','reviewed_with_plan')),
  rationale TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (process_id IS NOT NULL OR plan_id IS NOT NULL),
  UNIQUE (organisation_id, risk_id, process_id, plan_id, relation_type),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_risk_continuity_links_risk
  ON enterprise_risk_continuity_links (organisation_id, risk_id);

CREATE INDEX IF NOT EXISTS idx_risk_continuity_links_process
  ON enterprise_risk_continuity_links (organisation_id, process_id);

CREATE INDEX IF NOT EXISTS idx_risk_continuity_links_plan
  ON enterprise_risk_continuity_links (organisation_id, plan_id);

COMMIT;
