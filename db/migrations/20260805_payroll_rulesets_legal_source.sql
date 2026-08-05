-- Issue #363 (Paie — reprendre le module complet), lacune confirmée : « les
-- règles légales et fiscales doivent être versionnées, sourcées et validées
-- avant toute prétention de conformité ». payroll_rulesets est déjà versionné
-- (version, effective_from/effective_to, checksum) et déjà validé à
-- l'activation (activated_by/activated_at, réservé aux admins). Il manquait
-- la source : la référence au texte légal/fiscal (ex. guide de retenues à la
-- source de Revenu Québec, tables de l'ARC) sur lequel repose le jeu de
-- règles. Colonne nullable pour ne pas casser les jeux de règles déjà en
-- place ; la porte réelle est applicative (validateRulesetForActivation
-- refuse désormais l'activation d'un jeu de règles sans source).

BEGIN;

ALTER TABLE payroll_rulesets
  ADD COLUMN IF NOT EXISTS legal_source TEXT;

COMMENT ON COLUMN payroll_rulesets.legal_source IS
  'Référence du texte légal/fiscal source (ex. Revenu Québec, ARC, numéro de guide et édition). Obligatoire pour activer un jeu de règles.';

COMMIT;
