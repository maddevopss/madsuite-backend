-- 047_payment_reconciliation_logs.sql

CREATE TABLE IF NOT EXISTS payment_reconciliation_logs (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  reconciled_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
  invoices_checked INTEGER DEFAULT 0,
  invoices_updated INTEGER DEFAULT 0,
  details JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_logs_org_date 
ON payment_reconciliation_logs(organisation_id, reconciled_at);
