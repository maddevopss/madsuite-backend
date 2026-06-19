-- Migration 008: Ajouter colonne timezone par organisation
-- Permet de stocker le fuseau horaire de chaque organisation
-- au lieu de hardcoder 'America/Montreal' dans les requetes SQL

ALTER TABLE organisations
ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) DEFAULT 'America/Montreal';

-- Met a jour la valeur par defaut pour les organisations existantes
UPDATE organisations SET timezone = 'America/Montreal' WHERE timezone IS NULL;

ALTER TABLE organisations
ALTER COLUMN timezone SET NOT NULL;
