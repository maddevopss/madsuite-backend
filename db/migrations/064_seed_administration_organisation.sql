-- ============================================================
-- MADSuite / TimeMonitoring
-- 064_seed_administration_organisation.sql
-- Seed idempotent pour l'organisation système Administration
-- ============================================================
-- But :
-- - Créer ou mettre à jour l'organisation "Administration"
-- - Lui attribuer plan_type = 'admin' pour accès à tous les modules
-- - Rendre l'opération idempotente (safe pour rejouer)
-- - Ne pas écraser d'autres données

-- Insérer ou mettre à jour l'organisation Administration
INSERT INTO organisations (nom, plan_type, subscription_status, created_at)
VALUES (
  'Administration',
  'admin',
  'active',
  CURRENT_TIMESTAMP
)
ON CONFLICT (nom)
DO UPDATE SET
  plan_type = 'admin',
  subscription_status = 'active'
WHERE organisations.nom = 'Administration';

-- Seed tous les modules pour l'organisation Administration
-- (pour que l'API /organisation/modules les retourne)
INSERT INTO organisation_modules (organisation_id, module_key, is_active, activated_at)
SELECT
  o.id,
  m.key,
  true,
  CURRENT_TIMESTAMP
FROM organisations o
CROSS JOIN (
  VALUES
    ('dashboard'),
    ('timesheet'),
    ('clients'),
    ('projects'),
    ('time_tracking'),
    ('invoices'),
    ('reports'),
    ('kiosk_punch'),
    ('calcul_km'),
    ('kiosk_km'),
    ('estimates'),
    ('quotes'),
    ('expenses'),
    ('payments'),
    ('activity_intelligence'),
    ('billing_assistant'),
    ('cognitive_engine'),
    ('desktop_agent')
) AS m(key)
WHERE o.nom = 'Administration'
ON CONFLICT (organisation_id, module_key)
DO UPDATE SET
  is_active = true,
  activated_at = CURRENT_TIMESTAMP;
