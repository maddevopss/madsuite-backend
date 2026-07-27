BEGIN;

CREATE TABLE IF NOT EXISTS asset_maintenance_requests (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES asset_records(id),
  request_number TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  status TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','triaged','converted','rejected','closed')),
  reported_by BIGINT,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  triaged_by BIGINT,
  triaged_at TIMESTAMPTZ,
  work_order_id BIGINT REFERENCES asset_work_orders(id),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, request_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS asset_work_order_labour (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL REFERENCES asset_work_orders(id) ON DELETE CASCADE,
  employee_id BIGINT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  minutes_worked INTEGER NOT NULL CHECK (minutes_worked > 0),
  hourly_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (hourly_cost >= 0),
  note TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at >= started_at)
);

CREATE TABLE IF NOT EXISTS asset_work_order_parts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL REFERENCES asset_work_orders(id) ON DELETE CASCADE,
  inventory_item_id BIGINT,
  supplier_id BIGINT,
  part_number TEXT,
  description TEXT NOT NULL,
  quantity NUMERIC(14,4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  inventory_movement_id BIGINT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_return_to_service_checks (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL REFERENCES asset_work_orders(id) ON DELETE CASCADE,
  safe_to_operate BOOLEAN NOT NULL,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_by BIGINT NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, work_order_id)
);

CREATE TABLE IF NOT EXISTS asset_work_order_status_events (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  work_order_id BIGINT NOT NULL REFERENCES asset_work_orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor_user_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE asset_work_orders
  ADD COLUMN IF NOT EXISTS maintenance_request_id BIGINT REFERENCES asset_maintenance_requests(id),
  ADD COLUMN IF NOT EXISTS assigned_supplier_id BIGINT,
  ADD COLUMN IF NOT EXISTS diagnosis TEXT,
  ADD COLUMN IF NOT EXISTS resolution TEXT,
  ADD COLUMN IF NOT EXISTS safety_lock BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by BIGINT;

CREATE INDEX IF NOT EXISTS idx_asset_requests_status ON asset_maintenance_requests(organisation_id,status,priority,reported_at);
CREATE INDEX IF NOT EXISTS idx_asset_labour_work_order ON asset_work_order_labour(organisation_id,work_order_id);
CREATE INDEX IF NOT EXISTS idx_asset_parts_work_order ON asset_work_order_parts(organisation_id,work_order_id);
CREATE INDEX IF NOT EXISTS idx_asset_status_events_order ON asset_work_order_status_events(organisation_id,work_order_id,created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['asset_records','asset_maintenance_plans','asset_work_orders','asset_usage_readings','asset_maintenance_requests','asset_work_order_labour','asset_work_order_parts','asset_return_to_service_checks','asset_work_order_status_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', t);
    EXECUTE format('CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::BIGINT) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::BIGINT)', t);
  END LOOP;
END $$;

COMMIT;
