-- Étage 8 PR E — Niveaux de service et objectifs (issue #194).
--
-- Objectifs (disponibilité, délai de réponse, délai de rétablissement)
-- définis par service (service_key, cf. PR B/C — pas de FK, le registre
-- de services de la PR A reste un module en mémoire sans persistance).
-- Un seul objectif "actif" par service à la fois (index unique partiel) ;
-- redéfinir un objectif retire l'ancien plutôt que de le supprimer,
-- pour garder l'historique. Les résultats et budgets d'erreur sont
-- calculés à la volée depuis operational_incidents (PR B), pas stockés :
-- aucune table de résultats précalculés, donc aucun risque de dérive
-- entre le calcul et les incidents réels.

BEGIN;

CREATE TABLE IF NOT EXISTS operational_slo_objectives (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  service_key TEXT NOT NULL,
  availability_target NUMERIC(5,2) NOT NULL CHECK (availability_target > 0 AND availability_target <= 100),
  response_time_target_minutes INT NOT NULL CHECK (response_time_target_minutes > 0),
  restoration_time_target_minutes INT NOT NULL CHECK (restoration_time_target_minutes > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

-- Un seul objectif actif par service et par organisation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_slo_objectives_active_per_service
  ON operational_slo_objectives(organisation_id, service_key)
  WHERE status = 'active';

ALTER TABLE operational_slo_objectives ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_slo_objectives FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_slo_objectives_org_isolation ON operational_slo_objectives;
CREATE POLICY operational_slo_objectives_org_isolation ON operational_slo_objectives
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
