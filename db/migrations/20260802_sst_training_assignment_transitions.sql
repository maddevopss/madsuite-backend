BEGIN;

-- Suite du même audit RH/SST (2026-08-02) : sst-complete-block.service.js
-- (assessTrainingCompliance) et la table sst_training_assignments
-- existaient (migration du 27/07) sans jamais être montés sur aucune
-- route. sst_training_assignments ne porte un idempotency_key que pour sa
-- création, pas pour ses transitions successives (assigned -> in_progress
-- -> completed, ou waived/cancelled/expired). Cette table comble les deux
-- à la fois, sur le modèle déjà établi par hr_performance_review_transitions
-- et sst_incident_investigation_transitions.
CREATE TABLE IF NOT EXISTS sst_training_assignment_transitions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  assignment_id BIGINT NOT NULL REFERENCES sst_training_assignments(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  previous_status VARCHAR(20) NOT NULL,
  new_status VARCHAR(20) NOT NULL,
  actor_user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_sst_training_assignment_transitions_assignment
  ON sst_training_assignment_transitions(organisation_id, assignment_id, created_at DESC);

ALTER TABLE sst_training_assignment_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sst_training_assignment_transitions_org ON sst_training_assignment_transitions;
CREATE POLICY sst_training_assignment_transitions_org ON sst_training_assignment_transitions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

COMMIT;
