BEGIN;

CREATE TABLE IF NOT EXISTS hr_performance_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  reviewer_user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','employee_input','manager_review','acknowledged','closed','cancelled')),
  objectives JSONB NOT NULL DEFAULT '[]'::jsonb,
  competencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  employee_comments TEXT,
  manager_comments TEXT,
  overall_rating NUMERIC(4,2) CHECK (overall_rating BETWEEN 0 AND 5),
  acknowledged_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,idempotency_key),
  CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS hr_policy_acknowledgements (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  policy_code VARCHAR(100) NOT NULL,
  policy_version VARCHAR(80) NOT NULL,
  document_id BIGINT,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','declined','expired','revoked')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key VARCHAR(180) NOT NULL,
  UNIQUE (organisation_id,idempotency_key),
  UNIQUE (organisation_id,employee_id,policy_code,policy_version)
);

CREATE TABLE IF NOT EXISTS hr_offboarding_cases (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  reason_code VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','blocked','completed','cancelled')),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  outstanding_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  exit_interview JSONB NOT NULL DEFAULT '{}'::jsonb,
  payroll_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  access_revoked BOOLEAN NOT NULL DEFAULT FALSE,
  property_returned BOOLEAN NOT NULL DEFAULT FALSE,
  documents_completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  idempotency_key VARCHAR(180) NOT NULL,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,idempotency_key),
  UNIQUE (organisation_id,employee_id,effective_date)
);

ALTER TABLE hr_performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_policy_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_offboarding_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_performance_reviews_org ON hr_performance_reviews USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
CREATE POLICY hr_policy_acknowledgements_org ON hr_policy_acknowledgements USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
CREATE POLICY hr_offboarding_cases_org ON hr_offboarding_cases USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);

COMMIT;
