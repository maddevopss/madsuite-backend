BEGIN;

CREATE TABLE IF NOT EXISTS procurement_requisitions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  requisition_number TEXT NOT NULL,
  title TEXT NOT NULL,
  justification TEXT NOT NULL,
  requested_by BIGINT,
  needed_by DATE,
  currency TEXT NOT NULL DEFAULT 'CAD',
  estimated_total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (estimated_total >= 0),
  budget_code TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','converted','cancelled')),
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  decision_reason TEXT,
  idempotency_key TEXT,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, requisition_number)
);

CREATE TABLE IF NOT EXISTS procurement_requisition_items (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  requisition_id BIGINT NOT NULL REFERENCES procurement_requisitions(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  inventory_item_id BIGINT,
  asset_category TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS procurement_purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  purchase_order_number TEXT NOT NULL,
  requisition_id BIGINT REFERENCES procurement_requisitions(id),
  supplier_id BIGINT,
  currency TEXT NOT NULL DEFAULT 'CAD',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  taxes NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (taxes >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  expected_at DATE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','partially_received','received','closed','cancelled')),
  terms JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  cancellation_reason TEXT,
  idempotency_key TEXT,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, purchase_order_number)
);

CREATE TABLE IF NOT EXISTS procurement_receipts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  purchase_order_id BIGINT NOT NULL REFERENCES procurement_purchase_orders(id),
  receipt_number TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by BIGINT,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','partial','rejected','returned')),
  condition_notes TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, receipt_number)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_invoices (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_id BIGINT,
  purchase_order_id BIGINT REFERENCES procurement_purchase_orders(id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  due_date DATE,
  currency TEXT NOT NULL DEFAULT 'CAD',
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  taxes NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (taxes >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','matched','exception','approved','paid','void')),
  match_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  exception_reason TEXT,
  idempotency_key TEXT,
  ct_mad_transaction_id UUID,
  correlation_id UUID,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, supplier_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_procurement_requisitions_org_status ON procurement_requisitions(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_procurement_orders_org_status ON procurement_purchase_orders(organisation_id, status);
CREATE INDEX IF NOT EXISTS idx_procurement_receipts_org_po ON procurement_receipts(organisation_id, purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_procurement_invoices_org_status ON procurement_supplier_invoices(organisation_id, status);

COMMIT;
