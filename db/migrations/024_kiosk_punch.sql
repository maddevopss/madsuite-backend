-- ============================================================
-- MADSuite / TimeMonitoring
-- 024_kiosk_punch.sql
-- Ajout des colonnes pour le mode Kiosque
-- ============================================================

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS kiosk_token VARCHAR(64) UNIQUE;

-- Générer un token pour les organisations existantes
UPDATE organisations
SET kiosk_token = md5(random()::text || id::text)
WHERE kiosk_token IS NULL;

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS pin_hash VARCHAR(255),
  ADD COLUMN IF NOT EXISTS is_kiosk_user BOOLEAN DEFAULT FALSE;

-- Index pour accélérer la recherche par token kiosque
CREATE INDEX IF NOT EXISTS idx_organisations_kiosk_token ON organisations(kiosk_token);
