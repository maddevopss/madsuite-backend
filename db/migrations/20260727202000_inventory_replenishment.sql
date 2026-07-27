BEGIN;

CREATE TABLE IF NOT EXISTS inventory_replenishment_policies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  location_id BIGINT REFERENCES inventory_locations(id),
  preferred_supplier_id BIGINT REFERENCES suppliers(id),
  reorder_point NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  reorder_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
  safety_stock NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  lead_time_days INTEGER NOT NULL DEFAULT 0 CHECK (lead_time_days >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (organisation_id,item_id,location_id)
);

CREATE TABLE IF NOT EXISTS inventory_replenishment_suggestions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  policy_id BIGINT NOT NULL REFERENCES inventory_replenishment_policies(id) ON DELETE CASCADE,
  item_id BIGINT NOT NULL REFERENCES inventory_items(id),
  location_id BIGINT REFERENCES inventory_locations(id),
  quantity_on_hand NUMERIC(14,3) NOT NULL,
  quantity_reserved NUMERIC(14,3) NOT NULL DEFAULT 0,
  quantity_on_order NUMERIC(14,3) NOT NULL DEFAULT 0,
  suggested_quantity NUMERIC(14,3) NOT NULL CHECK (suggested_quantity > 0),
  needed_by DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','ordered','dismissed','cancelled')),
  purchase_order_id BIGINT REFERENCES procurement_purchase_orders(id),
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,idempotency_key)
);

ALTER TABLE inventory_replenishment_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_replenishment_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY inventory_replenishment_policies_org ON inventory_replenishment_policies USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY inventory_replenishment_suggestions_org ON inventory_replenishment_suggestions USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);

COMMIT;
