-- Étage 8 PR G — Revues d'exploitation (issue #194).
--
-- Synthèse hebdomadaire/mensuelle capturée en instantané figé au moment
-- de la revue (summary JSONB) — pas une vue recalculée à chaque lecture :
-- une revue reste une preuve historique stable même si les incidents,
-- changements, seuils de capacité ou risques évoluent ensuite. Chaque
-- revue porte des décisions (responsable + échéance) ; une revue ne peut
-- être fermée que si toutes ses décisions ont une preuve de suivi.

BEGIN;

CREATE TABLE IF NOT EXISTS operational_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  review_type TEXT NOT NULL CHECK (review_type IN ('weekly','monthly')),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_at TIMESTAMPTZ,
  closed_by BIGINT,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, review_type, period_start),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS operational_review_decisions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  review_id BIGINT NOT NULL REFERENCES operational_reviews(id),
  decision TEXT NOT NULL,
  responsible_user_id BIGINT NOT NULL,
  due_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  follow_up_evidence TEXT,
  done_at TIMESTAMPTZ,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operational_reviews_org_period
  ON operational_reviews(organisation_id, review_type, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_operational_review_decisions_org_review
  ON operational_review_decisions(organisation_id, review_id);

ALTER TABLE operational_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_reviews FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_reviews_org_isolation ON operational_reviews;
CREATE POLICY operational_reviews_org_isolation ON operational_reviews
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE operational_review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_review_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_review_decisions_org_isolation ON operational_review_decisions;
CREATE POLICY operational_review_decisions_org_isolation ON operational_review_decisions
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
