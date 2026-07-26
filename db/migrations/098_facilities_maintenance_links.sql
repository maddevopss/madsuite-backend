CREATE TABLE IF NOT EXISTS facilities_maintenance_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  facilities_asset_id BIGINT NOT NULL REFERENCES facilities_assets(id),
  maintenance_asset_id BIGINT NOT NULL REFERENCES asset_records(id),
  relationship_type TEXT NOT NULL DEFAULT 'same_asset',
  justification TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, facilities_asset_id, maintenance_asset_id),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_facilities_maintenance_links_org
  ON facilities_maintenance_links (organisation_id, facilities_asset_id);
