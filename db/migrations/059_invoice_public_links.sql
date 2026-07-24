BEGIN;

CREATE TABLE IF NOT EXISTS invoice_public_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_accessed_at TIMESTAMPTZ,
  CONSTRAINT invoice_public_links_expiry_after_creation
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_public_links_active_invoice
  ON invoice_public_links (organisation_id, invoice_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_public_links_lookup
  ON invoice_public_links (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_public_links_org_invoice
  ON invoice_public_links (organisation_id, invoice_id, created_at DESC);

COMMENT ON TABLE invoice_public_links IS
  'Liens publics de facture. Seule une empreinte SHA-256 du jeton est conservée.';
COMMENT ON COLUMN invoice_public_links.token_hash IS
  'Empreinte SHA-256 hexadécimale du jeton public; le jeton brut ne doit jamais être persisté.';

COMMIT;
