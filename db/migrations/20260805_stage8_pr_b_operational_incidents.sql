-- Étage 8 PR B — Incidents opérationnels (issue #194)
--
-- Constat préalable (triage automatisé du 2026-08-05, commentaires sur
-- l'issue #194) : seule la PR A (registre des services,
-- src/operations/serviceRegistry.js) existe réellement sur main — module
-- pur, en mémoire, sans table ni route. Les PR B à H "fermées" par la
-- chaîne de PR #201-#244 ont été fusionnées sur des branches
-- feat/stage8-* qui n'ont jamais atteint main ; l'issue #194 est restée
-- ouverte malgré le "Closes #194" de la PR #244. Ce fichier introduit la
-- première brique réellement persistée du chantier : le registre des
-- incidents opérationnels, avec isolation RLS par organisation comme le
-- reste du schéma depuis l'Étage 6.

BEGIN;

CREATE TABLE IF NOT EXISTS operational_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  incident_number TEXT NOT NULL,
  service_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  impact_summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'declared' CHECK (status IN ('declared','contained','restored','closed')),
  responsible_user_id BIGINT NOT NULL,
  declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  contained_at TIMESTAMPTZ,
  restored_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  provisional_cause TEXT,
  restoration_proof TEXT,
  closure_summary TEXT,
  links JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, incident_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_operational_incidents_org_status
  ON operational_incidents(organisation_id, status, declared_at DESC);

ALTER TABLE operational_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_incidents_org_isolation ON operational_incidents;
CREATE POLICY operational_incidents_org_isolation ON operational_incidents
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
