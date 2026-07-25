CREATE TABLE IF NOT EXISTS facilities_sites (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  site_code TEXT NOT NULL,
  name TEXT NOT NULL,
  site_type TEXT NOT NULL,
  address JSONB NOT NULL DEFAULT '{}'::jsonb,
  responsible_user_id BIGINT NOT NULL,
  operating_status TEXT NOT NULL DEFAULT 'active',
  commissioned_at DATE,
  closed_at DATE,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, site_code),
  CHECK (closed_at IS NULL OR commissioned_at IS NULL OR closed_at >= commissioned_at)
);

CREATE TABLE IF NOT EXISTS facilities_spaces (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  site_id BIGINT NOT NULL REFERENCES facilities_sites(id),
  parent_space_id BIGINT REFERENCES facilities_spaces(id),
  space_code TEXT NOT NULL,
  name TEXT NOT NULL,
  space_type TEXT NOT NULL,
  responsible_user_id BIGINT NOT NULL,
  capacity NUMERIC(12,2),
  capacity_unit TEXT,
  operating_status TEXT NOT NULL DEFAULT 'active',
  commissioned_at DATE,
  decommissioned_at DATE,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, space_code),
  CHECK (decommissioned_at IS NULL OR commissioned_at IS NULL OR decommissioned_at >= commissioned_at)
);

CREATE TABLE IF NOT EXISTS facilities_assets (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  site_id BIGINT REFERENCES facilities_sites(id),
  space_id BIGINT REFERENCES facilities_spaces(id),
  asset_code TEXT NOT NULL,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  responsible_user_id BIGINT NOT NULL,
  acquisition_cost NUMERIC(14,2),
  currency_code TEXT NOT NULL DEFAULT 'CAD',
  acquired_at DATE,
  commissioned_at DATE,
  status TEXT NOT NULL DEFAULT 'active',
  criticality TEXT NOT NULL DEFAULT 'normal',
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, asset_code)
);

CREATE TABLE IF NOT EXISTS facilities_inspections (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id BIGINT NOT NULL,
  inspection_number TEXT NOT NULL,
  inspected_at TIMESTAMPTZ NOT NULL,
  inspector_user_id BIGINT NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  deficiencies JSONB NOT NULL DEFAULT '[]'::jsonb,
  corrective_actions JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, inspection_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS facilities_transfers (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id BIGINT NOT NULL,
  from_site_id BIGINT REFERENCES facilities_sites(id),
  from_space_id BIGINT REFERENCES facilities_spaces(id),
  to_site_id BIGINT REFERENCES facilities_sites(id),
  to_space_id BIGINT REFERENCES facilities_spaces(id),
  requested_by_user_id BIGINT NOT NULL,
  accepted_by_user_id BIGINT,
  reason TEXT NOT NULL,
  transferred_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS facilities_disposals (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  asset_id BIGINT NOT NULL REFERENCES facilities_assets(id),
  disposal_method TEXT NOT NULL,
  reason TEXT NOT NULL,
  residual_value NUMERIC(14,2),
  currency_code TEXT NOT NULL DEFAULT 'CAD',
  requested_by_user_id BIGINT NOT NULL,
  approved_by_user_id BIGINT,
  disposed_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, asset_id, idempotency_key),
  CHECK (residual_value IS NULL OR residual_value >= 0)
);

CREATE INDEX IF NOT EXISTS idx_facilities_sites_status ON facilities_sites (organisation_id, operating_status);
CREATE INDEX IF NOT EXISTS idx_facilities_spaces_site ON facilities_spaces (organisation_id, site_id, operating_status);
CREATE INDEX IF NOT EXISTS idx_facilities_assets_location ON facilities_assets (organisation_id, site_id, space_id, status);
CREATE INDEX IF NOT EXISTS idx_facilities_inspections_subject ON facilities_inspections (organisation_id, subject_type, subject_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS idx_facilities_transfers_status ON facilities_transfers (organisation_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_facilities_disposals_status ON facilities_disposals (organisation_id, status, created_at DESC);
