-- Étage 8 PR D — Changements et fenêtres d'entretien (issue #194).
--
-- Demande de changement avec évaluation du risque et plan de retour
-- arrière obligatoires dès la demande ; approbation indépendante
-- (l'approbateur ne peut pas être le demandeur, et un changement à
-- risque élevé/critique exige un approbateur admin) ; fenêtre planifiée
-- (calendrier) ; preuve d'exécution obligatoire ; retour arrière possible
-- après exécution avec motif obligatoire.

BEGIN;

CREATE TABLE IF NOT EXISTS operational_changes (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  change_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  rollback_plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','scheduled','executed','rolled_back','rejected','cancelled')),
  requested_by BIGINT NOT NULL,
  approved_by BIGINT,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  scheduled_window_start TIMESTAMPTZ,
  scheduled_window_end TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  execution_proof TEXT,
  rolled_back_at TIMESTAMPTZ,
  rollback_reason TEXT,
  cancellation_reason TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, change_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_operational_changes_org_status
  ON operational_changes(organisation_id, status, scheduled_window_start);

ALTER TABLE operational_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_changes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_changes_org_isolation ON operational_changes;
CREATE POLICY operational_changes_org_isolation ON operational_changes
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
