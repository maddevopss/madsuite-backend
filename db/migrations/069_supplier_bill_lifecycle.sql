BEGIN;

ALTER TABLE supplier_bills
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by bigint,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS void_idempotency_key varchar(255);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_bill_void_idempotency
  ON supplier_bills (organisation_id, void_idempotency_key)
  WHERE void_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS supplier_credit_notes (
  id bigserial PRIMARY KEY,
  organisation_id bigint NOT NULL,
  supplier_bill_id bigint NOT NULL REFERENCES supplier_bills(id),
  supplier_id bigint NOT NULL REFERENCES suppliers(id),
  credit_number varchar(64) NOT NULL,
  subtotal numeric(14,2) NOT NULL CHECK (subtotal >= 0),
  tax_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total numeric(14,2) NOT NULL CHECK (total > 0),
  reason text NOT NULL,
  idempotency_key varchar(255) NOT NULL,
  accounting_entry_id bigint,
  credited_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, credit_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_credit_notes_bill
  ON supplier_credit_notes (organisation_id, supplier_bill_id, credited_at DESC);

ALTER TABLE supplier_credit_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS supplier_credit_notes_org_isolation ON supplier_credit_notes;
CREATE POLICY supplier_credit_notes_org_isolation ON supplier_credit_notes
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::bigint);

COMMIT;
