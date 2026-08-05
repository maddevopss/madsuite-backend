-- Étage 8 PR C — Problèmes et causes profondes (issue #194).
--
-- Sépare l'incident ponctuel (PR B, operational_incidents — rétablir le
-- service au plus vite) du problème récurrent (cette PR — éliminer la
-- cause racine). Un problème peut être lié à plusieurs incidents
-- (linked_incident_ids) : chaque nouveau lien incrémente recurrence_count
-- et, s'il touche un problème déjà "résolu", le rouvre automatiquement
-- (la récidive prouve que le correctif n'a pas tenu). Un problème fermé
-- sans élimination complète de la cause devient une "erreur connue"
-- (closure_type='known_error') avec contournement documenté
-- (workaround), formant le registre des erreurs connues.

BEGIN;

CREATE TABLE IF NOT EXISTS operational_problems (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  problem_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','root_cause_identified','corrective_action_in_progress','resolved','closed')),
  closure_type TEXT CHECK (closure_type IN ('resolved','known_error')),
  workaround TEXT,
  root_cause TEXT,
  corrective_action TEXT,
  corrective_action_owner_id BIGINT,
  corrective_action_due_at TIMESTAMPTZ,
  verification_outcome TEXT CHECK (verification_outcome IN ('effective','ineffective')),
  linked_incident_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  recurrence_count INT NOT NULL DEFAULT 0,
  last_recurrence_at TIMESTAMPTZ,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  responsible_user_id BIGINT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, problem_number),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_operational_problems_org_status
  ON operational_problems(organisation_id, status, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_problems_org_closure_type
  ON operational_problems(organisation_id, closure_type);

ALTER TABLE operational_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_problems FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_problems_org_isolation ON operational_problems;
CREATE POLICY operational_problems_org_isolation ON operational_problems
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
