-- 035_timesheet_approvals.sql

ALTER TABLE time_entries 
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected'));

COMMENT ON COLUMN time_entries.status IS 'Statut de lapprobation (draft = brouillon, submitted = soumis, approved = approuve, rejected = rejete)';
