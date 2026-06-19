-- DANGER: manual database recreation only. This destroys the target database.
-- The source of truth for schema changes is ../migrations/.
-- ============================================================
-- MADSuite / TimeMonitoring
-- 000_recreate_database.sql
-- À lancer depuis la base postgres, pas madsuite
-- ============================================================

DROP DATABASE IF EXISTS "madsuite";
CREATE DATABASE "madsuite";
