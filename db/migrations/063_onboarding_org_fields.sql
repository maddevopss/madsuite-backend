-- 063_onboarding_org_fields.sql
-- Migration dédiée pour les colonnes d'onboarding de la table organisations.
-- Remplace le DDL dynamique qui était dans onboarding.routes.js (P1-1 fix).
-- Ces colonnes étaient précédemment créées à la volée via ALTER TABLE dans la route HTTP,
-- ce qui est une mauvaise pratique (race condition, incompatible avec les migrations contrôlées).

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS adresse TEXT,
  ADD COLUMN IF NOT EXISTS tax_numbers TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;

-- Mettre à jour les organisations existantes : considérées comme ayant complété l'onboarding
-- si elles ont déjà des données (évite de bloquer les utilisateurs existants).
UPDATE organisations
SET onboarding_completed = true
WHERE onboarding_completed IS NULL;
