CREATE TABLE IF NOT EXISTS procurement_finance_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  requisition_id BIGINT REFERENCES procurement_requisitions(id),
  purchase_order_id BIGINT REFERENCES procurement_purchase_orders(id),
  supplier_id BIGINT REFERENCES suppliers(id),
  supplier_bill_id BIGINT REFERENCES supplier_bills(id),
  budget_id BIGINT REFERENCES financial_budgets(id),
  relationship_type TEXT NOT NULL,
  justification TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (requisition_id IS NOT NULL OR purchase_order_id IS NOT NULL),
  CHECK (supplier_id IS NOT NULL OR supplier_bill_id IS NOT NULL OR budget_id IS NOT NULL),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_procurement_finance_links_org
  ON procurement_finance_links (organisation_id, purchase_order_id, requisition_id);
