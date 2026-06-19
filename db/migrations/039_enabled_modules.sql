-- ============================================================
-- MADSuite / TimeMonitoring
-- 039_enabled_modules.sql
-- Table des modules activés par organisation (feature gating)
-- ============================================================

CREATE TABLE IF NOT EXISTS organisation_modules (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  module_key VARCHAR(50) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  activated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  stripe_subscription_item_id VARCHAR(255),
  UNIQUE (organisation_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_org_modules_org_id ON organisation_modules(organisation_id);
CREATE INDEX IF NOT EXISTS idx_org_modules_key ON organisation_modules(module_key);

-- Seed : activer tous les modules existants pour les organisations actuelles (migration non-breaking)
INSERT INTO organisation_modules (organisation_id, module_key, is_active)
SELECT o.id, m.key, true
FROM organisations o
CROSS JOIN (
  VALUES 
    ('dashboard'), ('timesheet'), ('clients'), ('projects'),
    ('invoices'), ('reports'), ('kiosk_punch'),
    ('calcul_km'), ('kiosk_km')
) AS m(key)
ON CONFLICT (organisation_id, module_key) DO NOTHING;
