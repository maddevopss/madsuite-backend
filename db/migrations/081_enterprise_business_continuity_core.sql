BEGIN;

CREATE TABLE IF NOT EXISTS enterprise_business_processes (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  process_number TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  criticality TEXT NOT NULL CHECK (criticality IN ('low','medium','high','critical')),
  maximum_tolerable_downtime_minutes INTEGER NOT NULL CHECK (maximum_tolerable_downtime_minutes > 0),
  recovery_time_objective_minutes INTEGER NOT NULL CHECK (recovery_time_objective_minutes > 0),
  recovery_point_objective_minutes INTEGER CHECK (recovery_point_objective_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','suspended','retired')),
  next_review_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, process_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_process_dependencies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  process_id BIGINT NOT NULL REFERENCES enterprise_business_processes(id),
  dependency_type TEXT NOT NULL CHECK (dependency_type IN ('supplier','asset','software','document','employee','site','other')),
  dependency_reference TEXT NOT NULL,
  description TEXT NOT NULL,
  criticality TEXT NOT NULL CHECK (criticality IN ('low','medium','high','critical')),
  fallback_description TEXT,
  owner_user_id BIGINT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_continuity_plans (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  process_id BIGINT NOT NULL REFERENCES enterprise_business_processes(id),
  plan_number TEXT NOT NULL,
  title TEXT NOT NULL,
  scenario TEXT NOT NULL,
  activation_conditions TEXT NOT NULL,
  owner_user_id BIGINT NOT NULL,
  procedures JSONB NOT NULL DEFAULT '[]'::jsonb,
  resources JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','active','suspended','retired')),
  approved_at TIMESTAMPTZ,
  next_review_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, plan_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_recovery_procedures (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  plan_id BIGINT NOT NULL REFERENCES enterprise_continuity_plans(id),
  procedure_number TEXT NOT NULL,
  title TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  responsible_user_id BIGINT NOT NULL,
  expected_duration_minutes INTEGER CHECK (expected_duration_minutes > 0),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, procedure_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_continuity_exercises (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  plan_id BIGINT NOT NULL REFERENCES enterprise_continuity_plans(id),
  exercise_number TEXT NOT NULL,
  scenario TEXT NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result TEXT NOT NULL CHECK (result IN ('successful','partial','failed')),
  conclusion TEXT NOT NULL,
  observations JSONB NOT NULL DEFAULT '[]'::jsonb,
  improvements JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  executed_by BIGINT,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, exercise_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_major_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  plan_id BIGINT REFERENCES enterprise_continuity_plans(id),
  event_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('medium','high','critical')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','contained','recovering','closed')),
  decision_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  lessons_learned TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_user_id BIGINT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, event_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS enterprise_continuity_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  plan_id BIGINT NOT NULL REFERENCES enterprise_continuity_plans(id),
  review_number TEXT NOT NULL,
  reviewer_user_id BIGINT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  conclusion TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_review_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL,
  UNIQUE (organisation_id, review_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_business_processes_org_status_review ON enterprise_business_processes(organisation_id, status, next_review_at);
CREATE INDEX IF NOT EXISTS idx_process_dependencies_org_process ON enterprise_process_dependencies(organisation_id, process_id);
CREATE INDEX IF NOT EXISTS idx_continuity_plans_org_status_review ON enterprise_continuity_plans(organisation_id, status, next_review_at);
CREATE INDEX IF NOT EXISTS idx_continuity_exercises_org_plan ON enterprise_continuity_exercises(organisation_id, plan_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_major_events_org_status ON enterprise_major_events(organisation_id, status, started_at DESC);

COMMIT;
