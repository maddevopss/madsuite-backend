-- 060_add_organisation_id_to_utilisateurs.sql
-- Ajouter organisation_id pour RLS multi-tenant

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='utilisateurs') THEN
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns 
      WHERE table_name='utilisateurs' AND column_name='organisation_id') THEN
      ALTER TABLE utilisateurs 
      ADD COLUMN organisation_id INT NOT NULL DEFAULT 1;
    END IF;
    
    CREATE INDEX IF NOT EXISTS idx_utilisateurs_org_id ON utilisateurs(organisation_id);
    
    ALTER TABLE utilisateurs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS utilisateurs_rls ON utilisateurs;
    
    CREATE POLICY utilisateurs_rls ON utilisateurs
      USING (organisation_id = (current_setting('app.current_organisation_id'))::INT)
      WITH CHECK (organisation_id = (current_setting('app.current_organisation_id'))::INT);
  END IF;
END $$;

-- Ajouter organisation_id à password_reset_tokens (pour traçabilité)
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name='password_reset_tokens') THEN
    IF NOT EXISTS(SELECT 1 FROM information_schema.columns 
      WHERE table_name='password_reset_tokens' AND column_name='organisation_id') THEN
      ALTER TABLE password_reset_tokens 
      ADD COLUMN organisation_id INT NOT NULL DEFAULT 1;
    END IF;
    
    CREATE INDEX IF NOT EXISTS idx_password_reset_org_id ON password_reset_tokens(organisation_id);
    
    ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS password_reset_tokens_rls ON password_reset_tokens;
    
    CREATE POLICY password_reset_tokens_rls ON password_reset_tokens
      USING (organisation_id = (current_setting('app.current_organisation_id'))::INT)
      WITH CHECK (organisation_id = (current_setting('app.current_organisation_id'))::INT);
  END IF;
END $$;

COMMIT;