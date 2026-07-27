BEGIN;

CREATE TABLE IF NOT EXISTS inventory_valuation_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  snapshot_date DATE NOT NULL,
  item_id BIGINT,
  location_id BIGINT,
  quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  average_cost NUMERIC(18,4) NOT NULL DEFAULT 0,
  inventory_value NUMERIC(18,4) NOT NULL DEFAULT 0,
  source_max_transaction_id BIGINT,
  generated_by BIGINT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organisation_id,snapshot_date,item_id,location_id),
  FOREIGN KEY (organisation_id,item_id) REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id) REFERENCES inventory_locations(organisation_id,id)
);

CREATE TABLE IF NOT EXISTS inventory_replenishment_policies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  location_id BIGINT,
  lead_time_days INTEGER NOT NULL DEFAULT 7 CHECK (lead_time_days >= 0),
  review_period_days INTEGER NOT NULL DEFAULT 7 CHECK (review_period_days > 0),
  safety_stock NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  minimum_order_quantity NUMERIC(18,3) NOT NULL DEFAULT 1 CHECK (minimum_order_quantity > 0),
  order_multiple NUMERIC(18,3) NOT NULL DEFAULT 1 CHECK (order_multiple > 0),
  preferred_supplier_id BIGINT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,item_id,location_id),
  FOREIGN KEY (organisation_id,item_id) REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id) REFERENCES inventory_locations(organisation_id,id),
  FOREIGN KEY (organisation_id,preferred_supplier_id) REFERENCES suppliers(organisation_id,id)
);

CREATE TABLE IF NOT EXISTS inventory_replenishment_suggestions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  location_id BIGINT,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  horizon_days INTEGER NOT NULL,
  average_daily_usage NUMERIC(18,6) NOT NULL DEFAULT 0,
  available_quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  inbound_quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  projected_quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  reorder_point NUMERIC(18,3) NOT NULL DEFAULT 0,
  suggested_quantity NUMERIC(18,3) NOT NULL DEFAULT 0,
  stockout_date DATE,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','dismissed','ordered','expired')),
  accepted_purchase_order_id BIGINT,
  created_by BIGINT,
  UNIQUE (organisation_id,item_id,location_id,calculated_at),
  FOREIGN KEY (organisation_id,item_id) REFERENCES inventory_items(organisation_id,id),
  FOREIGN KEY (organisation_id,location_id) REFERENCES inventory_locations(organisation_id,id),
  FOREIGN KEY (organisation_id,accepted_purchase_order_id) REFERENCES procurement_purchase_orders(organisation_id,id)
);

CREATE INDEX IF NOT EXISTS inventory_valuation_snapshot_lookup_idx ON inventory_valuation_snapshots (organisation_id,snapshot_date,item_id,location_id);
CREATE INDEX IF NOT EXISTS inventory_replenishment_suggestions_open_idx ON inventory_replenishment_suggestions (organisation_id,status,stockout_date) WHERE status='open';

ALTER TABLE inventory_valuation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_replenishment_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_replenishment_suggestions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['inventory_valuation_snapshots','inventory_replenishment_policies','inventory_replenishment_suggestions']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant_policy ON %I', table_name, table_name);
    EXECUTE format('CREATE POLICY %I_tenant_policy ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true),'''')::BIGINT) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true),'''')::BIGINT)', table_name, table_name);
  END LOOP;
END $$;

COMMIT;
