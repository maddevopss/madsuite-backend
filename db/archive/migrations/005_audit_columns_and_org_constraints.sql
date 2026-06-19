-- ============================================================
-- MADSuite / TimeMonitoring
-- 005_audit_columns_and_org_constraints.sql
-- Colonnes d'audit legeres et garde-fous multi-organisation
-- ============================================================

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(50);

ALTER TABLE projets
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS estimated_hours DECIMAL(8, 2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0);

ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS invoice_id INTEGER;

CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_utilisateurs_updated_at ON utilisateurs;
CREATE TRIGGER trg_utilisateurs_updated_at
BEFORE UPDATE ON utilisateurs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_clients_updated_at ON clients;
CREATE TRIGGER trg_clients_updated_at
BEFORE UPDATE ON clients
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_projets_updated_at ON projets;
CREATE TRIGGER trg_projets_updated_at
BEFORE UPDATE ON projets
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DROP TRIGGER IF EXISTS trg_time_entries_updated_at ON time_entries;
CREATE TRIGGER trg_time_entries_updated_at
BEFORE UPDATE ON time_entries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_timestamp();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_utilisateurs_id_org') THEN
    ALTER TABLE utilisateurs
      ADD CONSTRAINT uq_utilisateurs_id_org UNIQUE (id, organisation_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_clients_id_org') THEN
    ALTER TABLE clients
      ADD CONSTRAINT uq_clients_id_org UNIQUE (id, organisation_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_projets_id_org') THEN
    ALTER TABLE projets
      ADD CONSTRAINT uq_projets_id_org UNIQUE (id, organisation_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_projets_client_org') THEN
    ALTER TABLE projets
      ADD CONSTRAINT fk_projets_client_org
      FOREIGN KEY (client_id, organisation_id)
      REFERENCES clients(id, organisation_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_time_entries_projet_org') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_time_entries_projet_org
      FOREIGN KEY (projet_id, organisation_id)
      REFERENCES projets(id, organisation_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_time_entries_utilisateur_org') THEN
    ALTER TABLE time_entries
      ADD CONSTRAINT fk_time_entries_utilisateur_org
      FOREIGN KEY (utilisateur_id, organisation_id)
      REFERENCES utilisateurs(id, organisation_id)
      ON DELETE CASCADE
      NOT VALID;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_clients_email
ON clients(email);

CREATE INDEX IF NOT EXISTS idx_time_entries_invoice_id
ON time_entries(invoice_id);
