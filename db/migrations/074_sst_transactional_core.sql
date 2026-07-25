BEGIN;

CREATE TABLE IF NOT EXISTS sst_hazards (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  location TEXT,
  probability SMALLINT NOT NULL CHECK (probability BETWEEN 1 AND 5),
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  risk_score SMALLINT NOT NULL CHECK (risk_score BETWEEN 1 AND 25),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','controlled','closed')),
  control_measures JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_employee_id BIGINT REFERENCES hr_employees(id),
  identified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  controlled_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  ct_mad_transaction_id TEXT,
  correlation_id UUID,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, code)
);

CREATE TABLE IF NOT EXISTS sst_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  incident_number TEXT NOT NULL,
  incident_type TEXT NOT NULL CHECK (incident_type IN ('near_miss','first_aid','injury','occupational_illness','property_damage','environmental')),
  occurred_at TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL,
  description TEXT NOT NULL,
  severity SMALLINT NOT NULL CHECK (severity BETWEEN 1 AND 5),
  immediate_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  persons_involved JSONB NOT NULL DEFAULT '[]'::jsonb,
  witnesses JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','investigating','investigated','closed')),
  reported_by BIGINT,
  investigation_started_at TIMESTAMPTZ,
  investigation_completed_at TIMESTAMPTZ,
  investigation_findings JSONB,
  root_causes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ct_mad_transaction_id TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, incident_number)
);

CREATE TABLE IF NOT EXISTS sst_inspections (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  inspection_number TEXT NOT NULL,
  inspection_type TEXT NOT NULL,
  location TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  inspector_employee_id BIGINT REFERENCES hr_employees(id),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  result TEXT CHECK (result IN ('pass','conditional','fail')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  ct_mad_transaction_id TEXT,
  correlation_id UUID,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, inspection_number)
);

CREATE TABLE IF NOT EXISTS sst_corrective_actions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('hazard','incident','inspection','audit','other')),
  source_id BIGINT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  owner_employee_id BIGINT REFERENCES hr_employees(id),
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','corrected','verified','closed','cancelled')),
  correction_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  corrected_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  verified_by BIGINT,
  closure_reason TEXT,
  ct_mad_transaction_id TEXT,
  correlation_id UUID,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sst_ppe_assets (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_code TEXT NOT NULL,
  ppe_type TEXT NOT NULL,
  manufacturer TEXT,
  model TEXT,
  serial_number TEXT,
  assigned_employee_id BIGINT REFERENCES hr_employees(id),
  issued_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  last_inspected_at TIMESTAMPTZ,
  next_inspection_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','assigned','maintenance','retired','lost')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, asset_code)
);

CREATE TABLE IF NOT EXISTS sst_ppe_inspections (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  ppe_asset_id BIGINT NOT NULL REFERENCES sst_ppe_assets(id),
  inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result TEXT NOT NULL CHECK (result IN ('pass','repair','retire')),
  findings TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  inspected_by BIGINT,
  ct_mad_transaction_id TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sst_hazards_org_status ON sst_hazards (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_sst_incidents_org_status ON sst_incidents (organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_sst_actions_org_due ON sst_corrective_actions (organisation_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_sst_ppe_org_next_inspection ON sst_ppe_assets (organisation_id, next_inspection_at);

COMMIT;
