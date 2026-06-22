-- 034_retention_phase3.sql
-- Phase 3: Recurring Invoices & Notifications

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  template_invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  frequency VARCHAR(30) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly', 'monthly', 'yearly')),
  next_issue_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_recurring_invoices_id_org
    UNIQUE (id, organisation_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_notifications_id_org
    UNIQUE (id, organisation_id)
);

CREATE INDEX IF NOT EXISTS idx_recurring_invoices_org_status
ON recurring_invoices(organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
ON notifications(utilisateur_id, is_read);
