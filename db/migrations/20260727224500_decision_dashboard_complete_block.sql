BEGIN;

CREATE TABLE IF NOT EXISTS decision_dashboard_closures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','evaluated','approved','published','reopened')),
  financial_health JSONB NOT NULL DEFAULT '{}'::jsonb,
  cashflow_outlook JSONB NOT NULL DEFAULT '{}'::jsonb,
  operational_scorecard JSONB NOT NULL DEFAULT '{}'::jsonb,
  risk_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  unresolved_alerts INTEGER NOT NULL DEFAULT 0 CHECK (unresolved_alerts >= 0),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_reason TEXT,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS decision_dashboard_quality_checks (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  closure_id BIGINT NOT NULL REFERENCES decision_dashboard_closures(id) ON DELETE CASCADE,
  check_code TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pass','fail','warning')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, closure_id, check_code)
);

CREATE INDEX IF NOT EXISTS idx_decision_dashboard_closures_org_status
  ON decision_dashboard_closures(organisation_id,status,period_end DESC);

ALTER TABLE decision_dashboard_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_dashboard_quality_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_dashboard_closures_org_isolation ON decision_dashboard_closures;
CREATE POLICY decision_dashboard_closures_org_isolation ON decision_dashboard_closures
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);

DROP POLICY IF EXISTS decision_dashboard_quality_checks_org_isolation ON decision_dashboard_quality_checks;
CREATE POLICY decision_dashboard_quality_checks_org_isolation ON decision_dashboard_quality_checks
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true),'')::bigint);

COMMIT;
