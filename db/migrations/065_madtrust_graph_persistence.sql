-- MADSuite — persistance MADTrust et graphe métier explicable.

CREATE TABLE IF NOT EXISTS madtrust_assessments (
  id BIGSERIAL PRIMARY KEY,
  assessment_id UUID NOT NULL,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  transaction_id VARCHAR(120) NOT NULL,
  correlation_id UUID,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  status VARCHAR(24) NOT NULL CHECK (status IN ('conforme','attention','non_conforme')),
  assessed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, assessment_id),
  UNIQUE (organisation_id, transaction_id)
);

CREATE TABLE IF NOT EXISTS madtrust_checks (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  assessment_id UUID NOT NULL,
  code VARCHAR(120) NOT NULL,
  passed BOOLEAN NOT NULL,
  severity VARCHAR(24) NOT NULL,
  explanation TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organisation_id, assessment_id)
    REFERENCES madtrust_assessments (organisation_id, assessment_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS business_graph_edges (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  transaction_id VARCHAR(120) NOT NULL,
  correlation_id UUID,
  from_type VARCHAR(80) NOT NULL,
  from_id VARCHAR(120) NOT NULL,
  relation VARCHAR(80) NOT NULL,
  to_type VARCHAR(80) NOT NULL,
  to_id VARCHAR(120) NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, transaction_id, from_type, from_id, relation, to_type, to_id)
);

CREATE INDEX IF NOT EXISTS idx_madtrust_assessments_transaction
  ON madtrust_assessments (organisation_id, transaction_id);
CREATE INDEX IF NOT EXISTS idx_madtrust_checks_assessment
  ON madtrust_checks (organisation_id, assessment_id);
CREATE INDEX IF NOT EXISTS idx_business_graph_from
  ON business_graph_edges (organisation_id, from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_business_graph_to
  ON business_graph_edges (organisation_id, to_type, to_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['madtrust_assessments','madtrust_checks','business_graph_edges'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int)', t
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_trust_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Les constats MADTrust et les relations métier sont immuables.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS madtrust_assessments_append_only ON madtrust_assessments;
CREATE TRIGGER madtrust_assessments_append_only
BEFORE UPDATE OR DELETE ON madtrust_assessments
FOR EACH ROW EXECUTE FUNCTION prevent_trust_evidence_mutation();

DROP TRIGGER IF EXISTS madtrust_checks_append_only ON madtrust_checks;
CREATE TRIGGER madtrust_checks_append_only
BEFORE UPDATE OR DELETE ON madtrust_checks
FOR EACH ROW EXECUTE FUNCTION prevent_trust_evidence_mutation();

DROP TRIGGER IF EXISTS business_graph_edges_append_only ON business_graph_edges;
CREATE TRIGGER business_graph_edges_append_only
BEFORE UPDATE OR DELETE ON business_graph_edges
FOR EACH ROW EXECUTE FUNCTION prevent_trust_evidence_mutation();
