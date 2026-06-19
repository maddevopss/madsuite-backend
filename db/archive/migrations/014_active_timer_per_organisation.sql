-- Un seul timer actif par utilisateur et par organisation.
-- organisation_id rend explicite la portée SaaS de cette règle métier.

DROP INDEX IF EXISTS idx_one_active_timer_per_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timer_per_user_org
ON time_entries(organisation_id, utilisateur_id)
WHERE end_time IS NULL AND deleted_at IS NULL;
