-- ============================================================
-- MADSuite / TimeMonitoring
-- 024_migration_execution_lock.sql
-- Création des tables pour le suivi détaillé et le verrouillage
-- ============================================================

-- Table de suivi enrichie pour plus de télémétrie sur les déploiements
CREATE TABLE IF NOT EXISTS schema_migrations_executed (
  version VARCHAR(255) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  status VARCHAR(20) NOT NULL DEFAULT 'success'
    CHECK (status IN ('success', 'failed', 'pending')),
  
  UNIQUE(version)
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_executed_at
  ON schema_migrations_executed(executed_at DESC);

-- Table de verrouillage (Pattern Singleton)
-- On utilise un ID fixe pour s'assurer qu'une seule ligne de lock existe
CREATE TABLE IF NOT EXISTS schema_migration_lock (
  id INTEGER PRIMARY KEY DEFAULT 1,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  locked_at TIMESTAMPTZ,
  locked_by VARCHAR(255),
  CONSTRAINT only_one_row CHECK (id = 1)
);

-- Initialisation de l'état déverrouillé
INSERT INTO schema_migration_lock (id, is_locked) 
VALUES (1, FALSE) 
ON CONFLICT DO NOTHING;
