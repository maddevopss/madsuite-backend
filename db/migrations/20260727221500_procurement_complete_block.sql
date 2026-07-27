BEGIN;

CREATE TABLE IF NOT EXISTS procurement_supplier_qualifications (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  qualification_type TEXT NOT NULL CHECK (qualification_type IN ('insurance','licence','certification','banking','tax','other')),
  reference_number TEXT,
  valid_until DATE,
  status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expiring','expired','suspended','revoked')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  verified_by BIGINT,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, supplier_id, qualification_type, reference_number)
);

CREATE TABLE IF NOT EXISTS procurement_quote_requests (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  requisition_id BIGINT REFERENCES procurement_requisitions(id),
  request_number TEXT NOT NULL,
  title TEXT NOT NULL,
  closes_at TIMESTAMPTZ,
  evaluation_criteria JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','closed','awarded','cancelled')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, request_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_quotes (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  quote_request_id BIGINT NOT NULL REFERENCES procurement_quote_requests(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL,
  quote_number TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  taxes NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (taxes >= 0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  delivery_days INTEGER,
  score NUMERIC(8,2),
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','selected','rejected')),
  decision_reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, quote_request_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS procurement_receipt_items (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  receipt_id BIGINT NOT NULL REFERENCES procurement_receipts(id) ON DELETE CASCADE,
  inventory_item_id BIGINT,
  description TEXT NOT NULL,
  ordered_quantity NUMERIC(14,3) NOT NULL CHECK (ordered_quantity >= 0),
  received_quantity NUMERIC(14,3) NOT NULL CHECK (received_quantity >= 0),
  rejected_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (rejected_quantity >= 0),
  unit_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  condition_status TEXT NOT NULL DEFAULT 'accepted' CHECK (condition_status IN ('accepted','damaged','nonconforming','rejected')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS procurement_invoice_matches (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_invoice_id BIGINT NOT NULL REFERENCES procurement_supplier_invoices(id) ON DELETE CASCADE,
  purchase_order_id BIGINT NOT NULL REFERENCES procurement_purchase_orders(id),
  receipt_id BIGINT REFERENCES procurement_receipts(id),
  amount_variance NUMERIC(14,2) NOT NULL DEFAULT 0,
  quantity_variance NUMERIC(14,3) NOT NULL DEFAULT 0,
  tolerance_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (tolerance_amount >= 0),
  result TEXT NOT NULL CHECK (result IN ('matched','exception','approved_exception')),
  exception_reason TEXT,
  approval_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  matched_by BIGINT,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, supplier_invoice_id)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_payments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_invoice_id BIGINT NOT NULL REFERENCES procurement_supplier_invoices(id),
  payment_reference TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'CAD',
  paid_at TIMESTAMPTZ NOT NULL,
  method TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, payment_reference),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS procurement_supplier_performance (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  supplier_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  quality_score NUMERIC(5,2) CHECK (quality_score BETWEEN 0 AND 100),
  delivery_score NUMERIC(5,2) CHECK (delivery_score BETWEEN 0 AND 100),
  compliance_score NUMERIC(5,2) CHECK (compliance_score BETWEEN 0 AND 100),
  overall_score NUMERIC(5,2) CHECK (overall_score BETWEEN 0 AND 100),
  incidents INTEGER NOT NULL DEFAULT 0 CHECK (incidents >= 0),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, supplier_id, period_start, period_end)
);

CREATE INDEX IF NOT EXISTS idx_procurement_qualifications_expiry ON procurement_supplier_qualifications(organisation_id, valid_until);
CREATE INDEX IF NOT EXISTS idx_procurement_quote_requests_status ON procurement_quote_requests(organisation_id, status, closes_at);
CREATE INDEX IF NOT EXISTS idx_procurement_invoice_matches_result ON procurement_invoice_matches(organisation_id, result);
CREATE INDEX IF NOT EXISTS idx_procurement_payments_invoice ON procurement_supplier_payments(organisation_id, supplier_invoice_id);
CREATE INDEX IF NOT EXISTS idx_procurement_performance_supplier ON procurement_supplier_performance(organisation_id, supplier_id, period_end DESC);

COMMIT;
