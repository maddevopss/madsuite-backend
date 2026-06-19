-- Migration 029: clarifier la contrainte organisation_id sur utilisateurs
-- Décision: ON DELETE SET NULL signifie qu'un utilisateur orphelin peut exister
-- mais ne peut plus se connecter (organisation_id est requis pour RLS).
-- Cette approche préserve l'audit trail sans laisser accès.

-- Optionnel: ajouter un CHECK pour documentar
ALTER TABLE utilisateurs ADD CONSTRAINT chk_org_context CHECK (
  -- Si l'utilisateur n'est pas soft-deleted, il DOIT avoir une organisation
  -- (l'enforcement applicatif via middleware le garantit)
  CASE 
    WHEN deleted_at IS NULL THEN organisation_id IS NOT NULL
    ELSE TRUE
  END
);

-- Commentaire pour la documentation
COMMENT ON COLUMN utilisateurs.organisation_id IS 
  'Organisation auquel l''utilisateur appartient. ON DELETE SET NULL orphelin l''utilisateur mais conserve l''audit trail. Utilisateurs orphelins ne peuvent pas se connecter (middleware requireOrganisation rejette).';