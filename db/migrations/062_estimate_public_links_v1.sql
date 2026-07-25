BEGIN;

CREATE TABLE IF NOT EXISTS estimate_public_links (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_accessed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimate_public_decisions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  link_id BIGINT REFERENCES estimate_public_links(id) ON DELETE SET NULL,
  decision VARCHAR(16) NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  signer_name VARCHAR(255) NOT NULL,
  consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  client_ip VARCHAR(64),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT estimate_public_decisions_one_per_estimate UNIQUE (organisation_id, estimate_id)
);

CREATE INDEX IF NOT EXISTS idx_estimate_public_links_org_estimate
  ON estimate_public_links (organisation_id, estimate_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_org_estimate_active
  ON invoices (organisation_id, estimate_id)
  WHERE estimate_id IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE estimate_public_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_public_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimate_public_links_org_isolation ON estimate_public_links;
CREATE POLICY estimate_public_links_org_isolation ON estimate_public_links
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

DROP POLICY IF EXISTS estimate_public_decisions_org_isolation ON estimate_public_decisions;
CREATE POLICY estimate_public_decisions_org_isolation ON estimate_public_decisions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::INTEGER);

COMMIT;
