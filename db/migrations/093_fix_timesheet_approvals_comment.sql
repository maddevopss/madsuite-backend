-- 093_fix_timesheet_approvals_comment.sql
-- Corriger le commentaire de la colonne status dans time_entries
-- La migration 035_timesheet_approvals.sql historique contenait une typo dans le commentaire
-- Cette migration additive corrige le commentaire pour la cohérence

COMMENT ON COLUMN time_entries.status IS 'Statut de l''approbation (draft = brouillon, submitted = soumis, approved = approuvé, rejected = rejeté)';
