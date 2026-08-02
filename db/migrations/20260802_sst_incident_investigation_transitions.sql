BEGIN;

-- Suite du même audit que hr_performance_review_transitions (20260802) :
-- sst-complete-block.service.js (transitionInvestigation/canCloseInvestigation)
-- et la table sst_incident_investigations existaient (migration du 27/07)
-- sans jamais être montés sur aucune route. sst_incident_investigations ne
-- porte un idempotency_key que pour sa création (contrainte unique dédiée),
-- pas pour ses transitions successives (open -> collecting -> analysis ->
-- review -> closed). Cette table comble les deux à la fois : dédup par
-- idempotency_key et historique consultable de l'enquête.
CREATE TABLE IF NOT EXISTS sst_incident_investigation_transitions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  investigation_id BIGINT NOT NULL REFERENCES sst_incident_investigations(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  previous_status VARCHAR(20) NOT NULL,
  new_status VARCHAR(20) NOT NULL,
  actor_user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sst_investigation_transitions_investigation
  ON sst_incident_investigation_transitions(organisation_id, investigation_id, created_at DESC);

ALTER TABLE sst_incident_investigation_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_incident_investigation_transitions_org ON sst_incident_investigation_transitions;
CREATE POLICY sst_incident_investigation_transitions_org ON sst_incident_investigation_transitions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

COMMIT;
