-- ============================================================
-- MADSuite / TimeMonitoring
-- 009_invoices_billing_metadata.sql
-- Facturation: ajouter billed_at / billed_by sur invoices
-- ============================================================

DO $$
BEGIN
  -- billed_at
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'invoices'
      AND column_name = 'billed_at'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN billed_at TIMESTAMPTZ;
  END IF;

  -- billed_by
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'invoices'
      AND column_name = 'billed_by'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN billed_by INTEGER;
  END IF;

  -- FK billed_by -> utilisateurs(id)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_invoices_billed_by'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT fk_invoices_billed_by
      FOREIGN KEY (billed_by)
      REFERENCES utilisateurs(id)
      ON DELETE SET NULL;
  END IF;

  -- Index pour filtrage
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE indexname = 'idx_invoices_org_billed_at'
  ) THEN
    CREATE INDEX idx_invoices_org_billed_at
      ON invoices(organisation_id, billed_at)
      WHERE deleted_at IS NULL;
  END IF;
END;
$$;

