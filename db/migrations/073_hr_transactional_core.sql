-- MADSuite — noyau transactionnel des ressources humaines

CREATE TABLE IF NOT EXISTS hr_employees (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES utilisateurs(id),
  employee_number VARCHAR(40) NOT NULL,
  legal_name VARCHAR(180) NOT NULL,
  preferred_name VARCHAR(120),
  work_email VARCHAR(255),
  personal_email VARCHAR(255),
  phone VARCHAR(40),
  employment_status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (employment_status IN ('draft','active','leave','suspended','terminated')),
  hire_date DATE,
  termination_date DATE,
  manager_employee_id BIGINT REFERENCES hr_employees(id),
  department VARCHAR(120),
  job_title VARCHAR(160),
  employment_type VARCHAR(24) NOT NULL DEFAULT 'employee' CHECK (employment_type IN ('employee','contractor','intern','temporary')),
  work_location VARCHAR(160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, employee_number)
);

CREATE TABLE IF NOT EXISTS hr_employment_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  event_type VARCHAR(40) NOT NULL CHECK (event_type IN ('hired','activated','role_changed','department_changed','manager_changed','leave_started','leave_ended','suspended','reinstated','terminated')),
  effective_date DATE NOT NULL,
  reason TEXT,
  previous_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key VARCHAR(160) NOT NULL,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS hr_onboarding_tasks (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  assigned_to INTEGER REFERENCES utilisateurs(id),
  due_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','waived')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_at TIMESTAMPTZ,
  completed_by INTEGER REFERENCES utilisateurs(id),
  waiver_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr_leave_requests (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(40) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  requested_units NUMERIC(10,2) NOT NULL CHECK (requested_units > 0),
  unit VARCHAR(12) NOT NULL DEFAULT 'day' CHECK (unit IN ('day','hour')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  reason TEXT,
  decision_reason TEXT,
  idempotency_key VARCHAR(160) NOT NULL,
  approved_by INTEGER REFERENCES utilisateurs(id),
  decided_at TIMESTAMPTZ,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS hr_competencies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  validity_days INTEGER,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (organisation_id, code)
);

CREATE TABLE IF NOT EXISTS hr_employee_competencies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  employee_id BIGINT NOT NULL REFERENCES hr_employees(id) ON DELETE CASCADE,
  competency_id BIGINT NOT NULL REFERENCES hr_competencies(id),
  issued_at DATE NOT NULL,
  expires_at DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expired','revoked','pending')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_by INTEGER REFERENCES utilisateurs(id),
  verified_at TIMESTAMPTZ,
  idempotency_key VARCHAR(160) NOT NULL,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_employees_status ON hr_employees (organisation_id, employment_status);
CREATE INDEX IF NOT EXISTS idx_hr_events_employee ON hr_employment_events (organisation_id, employee_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_hr_onboarding_employee ON hr_onboarding_tasks (organisation_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_leave_employee ON hr_leave_requests (organisation_id, employee_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_hr_competency_expiry ON hr_employee_competencies (organisation_id, status, expires_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr_employees','hr_employment_events','hr_onboarding_tasks','hr_leave_requests','hr_competencies','hr_employee_competencies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', t);
    EXECUTE format('CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int)', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_hr_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Les événements RH sont immuables; créez un nouvel événement compensatoire.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS hr_employment_events_append_only ON hr_employment_events;
CREATE TRIGGER hr_employment_events_append_only BEFORE UPDATE OR DELETE ON hr_employment_events
FOR EACH ROW EXECUTE FUNCTION prevent_hr_event_mutation();
