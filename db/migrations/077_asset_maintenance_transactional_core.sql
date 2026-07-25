BEGIN;

CREATE TABLE IF NOT EXISTS asset_records (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_code TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('equipment','vehicle','building','tool','it','other')),
  serial_number TEXT,
  registration_number TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','out_of_service','retired','disposed')),
  acquired_at DATE,
  acquisition_cost NUMERIC(14,2),
  residual_value NUMERIC(14,2),
  useful_life_months INTEGER,
  warranty_expires_at DATE,
  owner_user_id BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  ct_mad_transaction_id TEXT,
  correlation_id TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, asset_code)
);

CREATE TABLE IF NOT EXISTS asset_maintenance_plans (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES asset_records(id),
  name TEXT NOT NULL,
  maintenance_type TEXT NOT NULL CHECK (maintenance_type IN ('preventive','inspection','calibration','certification','seasonal')),
  interval_days INTEGER,
  interval_usage NUMERIC(14,2),
  usage_unit TEXT,
  next_due_at DATE,
  next_due_usage NUMERIC(14,2),
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','retired')),
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_work_orders (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES asset_records(id),
  maintenance_plan_id BIGINT REFERENCES asset_maintenance_plans(id),
  work_order_number TEXT NOT NULL,
  work_type TEXT NOT NULL CHECK (work_type IN ('preventive','corrective','inspection','calibration','repair','emergency')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','blocked','completed','verified','cancelled')),
  assigned_user_id BIGINT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ,
  downtime_minutes INTEGER NOT NULL DEFAULT 0,
  labour_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  parts_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  external_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  completion_reason TEXT,
  cancellation_reason TEXT,
  idempotency_key TEXT NOT NULL,
  ct_mad_transaction_id TEXT,
  correlation_id TEXT,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, work_order_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS asset_usage_readings (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES asset_records(id),
  reading_value NUMERIC(14,2) NOT NULL,
  reading_unit TEXT NOT NULL,
  measured_at TIMESTAMPTZ NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_records_org_status ON asset_records(organisation_id,status);
CREATE INDEX IF NOT EXISTS idx_asset_plans_due ON asset_maintenance_plans(organisation_id,next_due_at);
CREATE INDEX IF NOT EXISTS idx_asset_work_orders_due ON asset_work_orders(organisation_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_asset_usage_asset ON asset_usage_readings(organisation_id,asset_id,measured_at DESC);

COMMIT;
