-- 059_cognitive_enablement_rls.sql
-- Ajouter RLS à cognitive tables (INT foreign keys)

-- 1. cognitive_enablement (table nouvelle)
DO $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='cognitive_enablement') THEN
    CREATE TABLE cognitive_enablement (
      id SERIAL PRIMARY KEY,
      organisation_id INT NOT NULL,
      feature_name VARCHAR(255) NOT NULL,
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (organisation_id) REFERENCES organisations(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_cognitive_enablement_org_id 
    ON cognitive_enablement(organisation_id);
  END IF;
  
  ALTER TABLE cognitive_enablement ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS cognitive_enablement_rls ON cognitive_enablement;
  
  CREATE POLICY cognitive_enablement_rls ON cognitive_enablement
    USING (organisation_id = (current_setting('app.current_organisation_id'))::INT)
    WITH CHECK (organisation_id = (current_setting('app.current_organisation_id'))::INT);
END $$;

-- 2. cognitive_models (si elle existe)
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='cognitive_models') THEN
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns 
      WHERE table_name='cognitive_models' AND column_name='organisation_id') THEN
      ALTER TABLE cognitive_models 
      ADD COLUMN organisation_id INT NOT NULL DEFAULT 1;
    END IF;
    
    CREATE INDEX IF NOT EXISTS idx_cognitive_models_org_id 
    ON cognitive_models(organisation_id);
    
    ALTER TABLE cognitive_models ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS cognitive_models_rls ON cognitive_models;
    
    CREATE POLICY cognitive_models_rls ON cognitive_models
      USING (organisation_id = (current_setting('app.current_organisation_id'))::INT)
      WITH CHECK (organisation_id = (current_setting('app.current_organisation_id'))::INT);
  END IF;
END $$;

-- 3. cognitive_state_events (existante, vérifier RLS active)
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='cognitive_state_events') THEN
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='cognitive_state_events' AND policyname='cognitive_state_events_rls') THEN
      ALTER TABLE cognitive_state_events ENABLE ROW LEVEL SECURITY;
      CREATE POLICY cognitive_state_events_rls ON cognitive_state_events
        USING (organisation_id = (current_setting('app.current_organisation_id'))::INT)
        WITH CHECK (organisation_id = (current_setting('app.current_organisation_id'))::INT);
    END IF;
  END IF;
END $$;

-- 4. daily_cognitive_metrics (existante)
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='daily_cognitive_metrics') THEN
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='daily_cognitive_metrics' AND policyname='daily_cognitive_metrics_rls') THEN
      ALTER TABLE daily_cognitive_metrics ENABLE ROW LEVEL SECURITY;
      CREATE POLICY daily_cognitive_metrics_rls ON daily_cognitive_metrics
        USING (organisation_id = (current_setting('app.current_organisation_id'))::INT)
        WITH CHECK (organisation_id = (current_setting('app.current_organisation_id'))::INT);
    END IF;
  END IF;
END $$;

COMMIT;