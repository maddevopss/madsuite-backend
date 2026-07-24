BEGIN;

CREATE TABLE IF NOT EXISTS payment_reminder_settings (
  organisation_id INTEGER PRIMARY KEY REFERENCES organisations(id) ON DELETE CASCADE,
  automatic_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_reminder_attempts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  stage SMALLINT NOT NULL CHECK (stage IN (3, 7, 14)),
  mode VARCHAR(16) NOT NULL CHECK (mode IN ('manual', 'automatic')),
  status VARCHAR(16) NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'stopped')),
  recipient VARCHAR(320),
  subject VARCHAR(500),
  portal_link_expires_at TIMESTAMPTZ,
  error_code VARCHAR(120),
  error_message TEXT,
  requested_by INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_reminder_attempts_unique_stage UNIQUE (organisation_id, invoice_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_payment_reminder_attempts_org_invoice
  ON payment_reminder_attempts (organisation_id, invoice_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_reminder_attempts_status
  ON payment_reminder_attempts (status, requested_at);

ALTER TABLE payment_reminder_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reminder_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_reminder_settings_org_isolation ON payment_reminder_settings;
CREATE POLICY payment_reminder_settings_org_isolation ON payment_reminder_settings
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

DROP POLICY IF EXISTS payment_reminder_attempts_org_isolation ON payment_reminder_attempts;
CREATE POLICY payment_reminder_attempts_org_isolation ON payment_reminder_attempts
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

COMMIT;
