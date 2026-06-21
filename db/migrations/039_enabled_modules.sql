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

-- Trigger to auto-enable default modules for new organisations
CREATE OR REPLACE FUNCTION enable_default_modules_for_new_org()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO organisation_modules (organisation_id, module_key, is_active)
  VALUES 
    (NEW.id, 'dashboard', true),
    (NEW.id, 'timesheet', true),
    (NEW.id, 'clients', true),
    (NEW.id, 'projects', true),
    (NEW.id, 'invoices', true),
    (NEW.id, 'reports', true),
    (NEW.id, 'kiosk_punch', true),
    (NEW.id, 'calcul_km', true),
    (NEW.id, 'kiosk_km', true),
    (NEW.id, 'estimates', true),
    (NEW.id, 'activity_intelligence', true),
    (NEW.id, 'billing_assistant', true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_enable_default_modules ON organisations;
CREATE TRIGGER trigger_enable_default_modules
AFTER INSERT ON organisations
FOR EACH ROW
EXECUTE FUNCTION enable_default_modules_for_new_org();
