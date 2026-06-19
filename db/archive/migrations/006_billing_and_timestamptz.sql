-- ============================================================
-- MADSuite / TimeMonitoring
-- 006_billing_and_timestamptz.sql
-- Base facturation + timestamps timezone-aware
-- ============================================================

DO $$
DECLARE
  table_column RECORD;
BEGIN
  FOR table_column IN
    SELECT *
    FROM (VALUES
      ('organisations', 'created_at'),
      ('utilisateurs', 'created_at'),
      ('utilisateurs', 'updated_at'),
      ('utilisateurs', 'last_login_at'),
      ('utilisateurs', 'deleted_at'),
      ('clients', 'created_at'),
      ('clients', 'updated_at'),
      ('clients', 'deleted_at'),
      ('projets', 'created_at'),
      ('projets', 'updated_at'),
      ('projets', 'deleted_at'),
      ('time_entries', 'start_time'),
      ('time_entries', 'end_time'),
      ('time_entries', 'created_at'),
      ('time_entries', 'updated_at'),
      ('time_entries', 'deleted_at'),
      ('user_sessions', 'login_time'),
      ('user_sessions', 'logout_time'),
      ('user_sessions', 'created_at'),
      ('activity_logs', 'captured_at'),
      ('activity_daily_summary', 'created_at'),
      ('activity_patterns', 'created_at'),
      ('activity_app_rules', 'created_at'),
      ('activity_app_rules', 'updated_at'),
      ('activity_feedback', 'created_at'),
      ('activity_context_rules', 'created_at'),
      ('activity_context_rules', 'updated_at'),
      ('daily_summaries', 'created_at'),
      ('billing_ai_suggestions', 'created_at'),
      ('refresh_tokens', 'expires_at'),
      ('refresh_tokens', 'revoked_at'),
      ('refresh_tokens', 'created_at')
    ) AS columns(table_name, column_name)
  LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = table_column.table_name
        AND column_name = table_column.column_name
        AND data_type = 'timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE current_setting(''TIMEZONE'')',
        table_column.table_name,
        table_column.column_name,
        table_column.column_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  invoice_number VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'paid', 'void')),
  issue_date DATE,
  due_date DATE,
  subtotal DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  tax_total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,

  CONSTRAINT uq_invoices_id_org
    UNIQUE (id, organisation_id),

  CONSTRAINT uq_invoices_number_org
    UNIQUE (organisation_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  time_entry_id INTEGER REFERENCES time_entries(id) ON DELETE SET NULL,
  description TEXT,
  quantity DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit_rate DECIMAL(10, 2) NOT NULL DEFAULT 0 CHECK (unit_rate >= 0),
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_invoice_items_id_org
    UNIQUE (id, organisation_id)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_time_entries_invoice') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_time_entries_invoice
      FOREIGN KEY (invoice_id, organisation_id)
      REFERENCES invoices(id, organisation_id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices;
CREATE TRIGGER trg_invoices_updated_at
BEFORE UPDATE ON invoices
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

CREATE INDEX IF NOT EXISTS idx_invoices_org_status
ON invoices(organisation_id, status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_client_id
ON invoices(client_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id
ON invoice_items(invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_items_time_entry_id
ON invoice_items(time_entry_id);

DROP INDEX IF EXISTS idx_one_active_timer_per_user;
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer_per_user
ON time_entries(utilisateur_id)
WHERE end_time IS NULL AND deleted_at IS NULL;
