-- Étage 8 PR F — Coûts et capacité (issue #194).
--
-- Suit la CONSOMMATION opérationnelle (stockage, traitements,
-- fournisseurs) en unités physiques (GB, heures, appels, unités) — jamais
-- en montants monétaires. Aucun champ de coût/montant n'existe dans ce
-- schéma : le rattachement financier appartient au module comptabilité /
-- gestion financière avancée (advanced_financial_management), pas à ce
-- module d'exploitation. C'est la garantie structurelle contre la double
-- comptabilisation exigée par le mandat de cette PR.
--
-- operational_capacity_usage : relevés de consommation (quantity = niveau
-- ou volume constaté à recorded_at, pas un delta) — sert de base au calcul
-- de tendance/prévision en aval (route /forecast, calcul à la volée).
-- operational_capacity_thresholds : seuils d'alerte par service/ressource,
-- un seul seuil actif à la fois (redéfinir retire l'ancien, comme les
-- objectifs de niveau de service de la PR E).

BEGIN;

CREATE TABLE IF NOT EXISTS operational_capacity_usage (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  service_key TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('storage','compute','supplier','other')),
  supplier_key TEXT,
  unit TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity >= 0),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_operational_capacity_usage_org_service_resource
  ON operational_capacity_usage(organisation_id, service_key, resource_type, recorded_at DESC);

CREATE TABLE IF NOT EXISTS operational_capacity_thresholds (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL,
  service_key TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('storage','compute','supplier','other')),
  capacity_limit NUMERIC NOT NULL CHECK (capacity_limit > 0),
  warning_threshold_percent NUMERIC NOT NULL DEFAULT 80 CHECK (warning_threshold_percent > 0 AND warning_threshold_percent <= 100),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  idempotency_key TEXT NOT NULL,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operational_capacity_thresholds_active_per_resource
  ON operational_capacity_thresholds(organisation_id, service_key, resource_type)
  WHERE status = 'active';

ALTER TABLE operational_capacity_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_capacity_usage FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_capacity_usage_org_isolation ON operational_capacity_usage;
CREATE POLICY operational_capacity_usage_org_isolation ON operational_capacity_usage
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

ALTER TABLE operational_capacity_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_capacity_thresholds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_capacity_thresholds_org_isolation ON operational_capacity_thresholds;
CREATE POLICY operational_capacity_thresholds_org_isolation ON operational_capacity_thresholds
  USING (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint)
  WITH CHECK (organisation_id = (NULLIF(current_setting('app.current_organisation_id', true), ''))::bigint);

COMMIT;
