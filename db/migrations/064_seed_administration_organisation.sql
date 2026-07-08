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
--
-- Important : ne pas utiliser ON CONFLICT ici.
-- Le schéma historique ne garantit pas de contrainte UNIQUE sur organisations.nom
-- ni sur organisation_modules(organisation_id, module_key) dans tous les environnements.

-- Créer l'organisation Administration si elle n'existe pas déjà.
INSERT INTO organisations (nom, plan_type, subscription_status, created_at)
SELECT
  'Administration',
  'admin',
  'active',
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM organisations
  WHERE nom = 'Administration'
);

-- Mettre à jour toutes les organisations Administration existantes sans dépendre d'une contrainte UNIQUE.
UPDATE organisations
SET
  plan_type = 'admin',
  subscription_status = 'active'
WHERE nom = 'Administration';

-- Seed tous les modules pour l'organisation Administration
-- (pour que l'API /organisation/modules les retourne)
WITH admin_orgs AS (
  SELECT id
  FROM organisations
  WHERE nom = 'Administration'
),
admin_modules(module_key) AS (
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
),
module_rows AS (
  SELECT
    o.id AS organisation_id,
    m.module_key
  FROM admin_orgs o
  CROSS JOIN admin_modules m
)
UPDATE organisation_modules om
SET
  is_active = true,
  activated_at = CURRENT_TIMESTAMP
FROM module_rows mr
WHERE om.organisation_id = mr.organisation_id
  AND om.module_key = mr.module_key;

WITH admin_orgs AS (
  SELECT id
  FROM organisations
  WHERE nom = 'Administration'
),
admin_modules(module_key) AS (
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
),
module_rows AS (
  SELECT
    o.id AS organisation_id,
    m.module_key
  FROM admin_orgs o
  CROSS JOIN admin_modules m
)
INSERT INTO organisation_modules (organisation_id, module_key, is_active, activated_at)
SELECT
  mr.organisation_id,
  mr.module_key,
  true,
  CURRENT_TIMESTAMP
FROM module_rows mr
WHERE NOT EXISTS (
  SELECT 1
  FROM organisation_modules om
  WHERE om.organisation_id = mr.organisation_id
    AND om.module_key = mr.module_key
);
