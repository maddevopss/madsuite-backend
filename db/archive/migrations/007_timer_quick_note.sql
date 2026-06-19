-- Phase 4: Timer intelligent
-- 1. Ajout colonne 'note' pour note rapide sur timer actif
-- 2. Index pour requetes avec fuseau horaire

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS note TEXT;

-- Index composite pour requetes timesheet avec timezone
CREATE INDEX IF NOT EXISTS idx_time_entries_user_start_tz
  ON time_entries (utilisateur_id, (start_time AT TIME ZONE 'America/Montreal'));
