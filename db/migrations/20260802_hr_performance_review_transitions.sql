BEGIN;

-- Suite de #698-style audit trouvé en RH : hr-complete-block.service.js
-- (transitionReview/evaluateReviewClosure) et la table hr_performance_reviews
-- existaient sans jamais être montés sur aucune route. hr_performance_reviews
-- porte déjà idempotency_key pour sa création, mais aucune colonne dédiée
-- pour dédupliquer ses transitions (employee_input/manager_review/
-- acknowledged/closed/cancelled) ni pour en garder l'historique — même
-- lacune que hr_employees avant hr_employment_events. Cette table comble les
-- deux à la fois : dédup par idempotency_key et historique consultable.
CREATE TABLE IF NOT EXISTS hr_performance_review_transitions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  review_id BIGINT NOT NULL REFERENCES hr_performance_reviews(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL,
  previous_status VARCHAR(20) NOT NULL,
  new_status VARCHAR(20) NOT NULL,
  actor_user_id BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  idempotency_key VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_hr_perf_review_transitions_review
  ON hr_performance_review_transitions(organisation_id, review_id, created_at DESC);

ALTER TABLE hr_performance_review_transitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_performance_review_transitions_org ON hr_performance_review_transitions;
CREATE POLICY hr_performance_review_transitions_org ON hr_performance_review_transitions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

COMMIT;
