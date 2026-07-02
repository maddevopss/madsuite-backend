-- 061_cognitive_metrics_unique_constraint.sql
-- Sprint 2 — Renforcement de la contrainte UNIQUE sur daily_cognitive_metrics
--
-- Contexte (audit multi-tenant 2026-06-24) :
-- La contrainte UNIQUE (utilisateur_id, date) est insuffisante pour un SaaS multi-tenant.
-- Si le modèle évolue vers un utilisateur pouvant appartenir à plusieurs organisations,
-- la contrainte actuelle permettrait des collisions cross-tenant.
-- On ajoute organisation_id à la contrainte pour garantir l'isolation future.
--
-- Impact sur cognitiveAggregator.js :
-- Le ON CONFLICT doit être mis à jour pour inclure organisation_id.

DO $$
BEGIN
  -- 1. Supprimer l'ancienne contrainte UNIQUE (utilisateur_id, date)
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'daily_cognitive_metrics_utilisateur_id_date_key'
      AND conrelid = 'daily_cognitive_metrics'::regclass
  ) THEN
    ALTER TABLE daily_cognitive_metrics 
    DROP CONSTRAINT daily_cognitive_metrics_utilisateur_id_date_key;
  END IF;

  -- Supprimer aussi si elle existe sous un autre nom
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'uq_daily_cognitive_metrics_user_org_date'
      AND conrelid = 'daily_cognitive_metrics'::regclass
  ) THEN
    ALTER TABLE daily_cognitive_metrics 
    DROP CONSTRAINT uq_daily_cognitive_metrics_user_org_date;
  END IF;

  -- 2. Ajouter la nouvelle contrainte composite incluant organisation_id
  ALTER TABLE daily_cognitive_metrics
  ADD CONSTRAINT uq_daily_cognitive_metrics_user_org_date 
  UNIQUE (utilisateur_id, organisation_id, date);

END $$;

COMMENT ON CONSTRAINT uq_daily_cognitive_metrics_user_org_date ON daily_cognitive_metrics
IS 'Contrainte UNIQUE composite incluant organisation_id pour garantir l''isolation multi-tenant future.';
