CREATE TABLE IF NOT EXISTS metrics_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  mrr NUMERIC(10, 2) DEFAULT 0,
  revenue_month NUMERIC(10, 2) DEFAULT 0,
  invoices_paid INT DEFAULT 0,
  invoices_due NUMERIC(10, 2) DEFAULT 0,
  invoices_overdue NUMERIC(10, 2) DEFAULT 0,
  recurring_count INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organisation_id, date)
);

CREATE INDEX idx_metrics_snapshot_org_date ON metrics_snapshot(organisation_id, date);
