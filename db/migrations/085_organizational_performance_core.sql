BEGIN;

CREATE TABLE IF NOT EXISTS performance_objectives (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  objective_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES utilisateurs(id),
  parent_objective_id BIGINT REFERENCES performance_objectives(id),
  perspective TEXT NOT NULL CHECK (perspective IN ('financial','customer','operations','people','risk','sustainability')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','at_risk','achieved','cancelled','closed')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  baseline NUMERIC,
  target NUMERIC,
  unit TEXT,
  approved_by_user_id BIGINT REFERENCES utilisateurs(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, objective_number),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS performance_indicators (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  objective_id BIGINT NOT NULL REFERENCES performance_objectives(id) ON DELETE CASCADE,
  indicator_number TEXT NOT NULL,
  name TEXT NOT NULL,
  definition TEXT NOT NULL,
  formula TEXT NOT NULL,
  source_system TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES utilisateurs(id),
  direction TEXT NOT NULL CHECK (direction IN ('higher_is_better','lower_is_better','target_range')),
  frequency TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly','quarterly','annual','event_driven')),
  unit TEXT NOT NULL,
  baseline NUMERIC,
  target NUMERIC NOT NULL,
  warning_threshold NUMERIC,
  critical_threshold NUMERIC,
  tolerance_low NUMERIC,
  tolerance_high NUMERIC,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, indicator_number)
);

CREATE TABLE IF NOT EXISTS performance_measurements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  indicator_id BIGINT NOT NULL REFERENCES performance_indicators(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  value NUMERIC NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('on_target','warning','critical','not_evaluable')),
  source_reference TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  measured_by_user_id BIGINT NOT NULL REFERENCES utilisateurs(id),
  commentary TEXT,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, indicator_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS performance_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  objective_id BIGINT NOT NULL REFERENCES performance_objectives(id) ON DELETE CASCADE,
  review_number TEXT NOT NULL,
  review_date DATE NOT NULL,
  reviewer_user_id BIGINT NOT NULL REFERENCES utilisateurs(id),
  overall_status TEXT NOT NULL CHECK (overall_status IN ('on_track','watch','off_track','achieved','not_evaluable')),
  analysis TEXT NOT NULL,
  decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_review_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, review_number)
);

CREATE TABLE IF NOT EXISTS performance_improvement_plans (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  objective_id BIGINT REFERENCES performance_objectives(id) ON DELETE CASCADE,
  indicator_id BIGINT REFERENCES performance_indicators(id) ON DELETE CASCADE,
  plan_number TEXT NOT NULL,
  title TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  action_plan JSONB NOT NULL,
  owner_user_id BIGINT NOT NULL REFERENCES utilisateurs(id),
  due_at DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','implemented','verified','closed','cancelled')),
  implementation_result TEXT,
  implementation_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  effectiveness_result TEXT,
  verification_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_by_user_id BIGINT REFERENCES utilisateurs(id),
  verified_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, plan_number),
  CHECK (objective_id IS NOT NULL OR indicator_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_performance_objectives_org_status ON performance_objectives(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_performance_indicators_objective ON performance_indicators(organisation_id, objective_id);
CREATE INDEX IF NOT EXISTS idx_performance_measurements_indicator_date ON performance_measurements(organisation_id, indicator_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_performance_plans_due ON performance_improvement_plans(organisation_id, status, due_at);

ALTER TABLE performance_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_improvement_plans ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['performance_objectives','performance_indicators','performance_measurements','performance_reviews','performance_improvement_plans'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', table_name);
    EXECUTE format('CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::BIGINT) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::BIGINT)', table_name);
  END LOOP;
END $$;

COMMIT;
