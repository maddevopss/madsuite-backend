-- ============================================================
-- MADSuite / TimeMonitoring
-- 040_module_pricing.sql
-- Table pour stocker les prix dynamiques des modules (add-ons)
-- ============================================================

CREATE TABLE IF NOT EXISTS module_pricing (
  module_key VARCHAR(50) PRIMARY KEY,
  price_cents INTEGER NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'cad',
  description TEXT
);

-- Seed des prix (exemple) – les valeurs sont en centimes CAD
INSERT INTO module_pricing (module_key, price_cents, description) VALUES
  ('calcul_km', 500, 'Calcul KM / GPS'),
  ('kiosk_km', 500, 'Kiosque Kilométrage'),
  ('estimates', 500, 'Soumissions'),
  ('activity_intelligence', 1000, 'Activity Intelligence'),
  ('billing_assistant', 1000, 'Billing Assistant')
ON CONFLICT (module_key) DO NOTHING;
