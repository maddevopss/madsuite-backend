BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_id_uq ON suppliers(organisation_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_purchase_orders_org_id_uq ON procurement_purchase_orders(organisation_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS procurement_receipts_org_id_uq ON procurement_receipts(organisation_id,id);

ALTER TABLE procurement_purchase_orders
  ADD CONSTRAINT procurement_purchase_orders_supplier_fk
  FOREIGN KEY (organisation_id,supplier_id) REFERENCES suppliers(organisation_id,id);

CREATE TABLE IF NOT EXISTS procurement_purchase_order_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  purchase_order_id BIGINT NOT NULL,
  inventory_item_id BIGINT NOT NULL,
  description TEXT NOT NULL,
  ordered_quantity NUMERIC(18,3) NOT NULL CHECK (ordered_quantity > 0),
  received_quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  returned_quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (returned_quantity >= 0),
  unit_cost NUMERIC(18,4) NOT NULL CHECK (unit_cost >= 0),
  tax_rate NUMERIC(8,5) NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
  line_subtotal NUMERIC(18,4) GENERATED ALWAYS AS (ordered_quantity * unit_cost) STORED,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_po_lines_order_fk FOREIGN KEY (organisation_id,purchase_order_id)
    REFERENCES procurement_purchase_orders(organisation_id,id) ON DELETE CASCADE,
  CONSTRAINT procurement_po_lines_item_fk FOREIGN KEY (organisation_id,inventory_item_id)
    REFERENCES inventory_items(organisation_id,id),
  CONSTRAINT procurement_po_lines_item_uq UNIQUE (organisation_id,purchase_order_id,inventory_item_id),
  CONSTRAINT procurement_po_lines_received_lte_ordered CHECK (received_quantity <= ordered_quantity),
  CONSTRAINT procurement_po_lines_returned_lte_received CHECK (returned_quantity <= received_quantity)
);

CREATE TABLE IF NOT EXISTS procurement_receipt_lines (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  receipt_id BIGINT NOT NULL,
  purchase_order_line_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  accepted_quantity NUMERIC(18,3) NOT NULL CHECK (accepted_quantity >= 0),
  rejected_quantity NUMERIC(18,3) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  unit_cost NUMERIC(18,4) NOT NULL CHECK (unit_cost >= 0),
  inventory_transaction_id BIGINT,
  condition_status TEXT NOT NULL DEFAULT 'accepted' CHECK (condition_status IN ('accepted','partial','rejected')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_receipt_lines_receipt_fk FOREIGN KEY (organisation_id,receipt_id)
    REFERENCES procurement_receipts(organisation_id,id) ON DELETE CASCADE,
  CONSTRAINT procurement_receipt_lines_po_line_fk FOREIGN KEY (purchase_order_line_id)
    REFERENCES procurement_purchase_order_lines(id),
  CONSTRAINT procurement_receipt_lines_location_fk FOREIGN KEY (organisation_id,location_id)
    REFERENCES inventory_locations(organisation_id,id),
  CONSTRAINT procurement_receipt_lines_split_check CHECK (accepted_quantity + rejected_quantity = quantity),
  CONSTRAINT procurement_receipt_lines_receipt_po_line_uq UNIQUE (organisation_id,receipt_id,purchase_order_line_id)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_returns (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  purchase_order_id BIGINT NOT NULL,
  purchase_order_line_id BIGINT NOT NULL,
  receipt_line_id BIGINT,
  supplier_id BIGINT NOT NULL,
  location_id BIGINT NOT NULL,
  return_number TEXT NOT NULL,
  quantity NUMERIC(18,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(18,4) NOT NULL CHECK (unit_cost >= 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','cancelled')),
  idempotency_key TEXT NOT NULL,
  inventory_transaction_id BIGINT,
  created_by BIGINT,
  returned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procurement_returns_order_fk FOREIGN KEY (organisation_id,purchase_order_id)
    REFERENCES procurement_purchase_orders(organisation_id,id),
  CONSTRAINT procurement_returns_supplier_fk FOREIGN KEY (organisation_id,supplier_id)
    REFERENCES suppliers(organisation_id,id),
  CONSTRAINT procurement_returns_location_fk FOREIGN KEY (organisation_id,location_id)
    REFERENCES inventory_locations(organisation_id,id),
  CONSTRAINT procurement_returns_number_uq UNIQUE (organisation_id,return_number),
  CONSTRAINT procurement_returns_idempotency_uq UNIQUE (organisation_id,idempotency_key)
);

CREATE INDEX IF NOT EXISTS procurement_po_lines_order_idx ON procurement_purchase_order_lines(organisation_id,purchase_order_id);
CREATE INDEX IF NOT EXISTS procurement_receipt_lines_receipt_idx ON procurement_receipt_lines(organisation_id,receipt_id);
CREATE INDEX IF NOT EXISTS procurement_returns_order_idx ON procurement_supplier_returns(organisation_id,purchase_order_id);

ALTER TABLE procurement_purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement_supplier_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS procurement_po_lines_tenant_policy ON procurement_purchase_order_lines;
CREATE POLICY procurement_po_lines_tenant_policy ON procurement_purchase_order_lines
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
DROP POLICY IF EXISTS procurement_receipt_lines_tenant_policy ON procurement_receipt_lines;
CREATE POLICY procurement_receipt_lines_tenant_policy ON procurement_receipt_lines
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
DROP POLICY IF EXISTS procurement_returns_tenant_policy ON procurement_supplier_returns;
CREATE POLICY procurement_returns_tenant_policy ON procurement_supplier_returns
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);

COMMIT;
