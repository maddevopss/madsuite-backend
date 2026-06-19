-- Migration 011: backfill du scope organisation et resume activite.

ALTER TABLE activity_daily_summary
  ADD COLUMN IF NOT EXISTS organisation_id INTEGER REFERENCES organisations(id);

UPDATE activity_daily_summary ads
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE ads.utilisateur_id = u.id
  AND ads.organisation_id IS NULL;

UPDATE activity_logs al
SET organisation_id = u.organisation_id
FROM utilisateurs u
WHERE al.utilisateur_id = u.id
  AND al.organisation_id IS NULL;

UPDATE time_entries te
SET organisation_id = COALESCE(
  (SELECT u.organisation_id FROM utilisateurs u WHERE u.id = te.utilisateur_id),
  (SELECT p.organisation_id FROM projets p WHERE p.id = te.projet_id)
)
WHERE te.organisation_id IS NULL;

UPDATE activity_app_rules
SET organisation_id = (SELECT id FROM organisations ORDER BY id LIMIT 1)
WHERE organisation_id IS NULL
  AND (SELECT COUNT(*) FROM organisations) = 1;

CREATE INDEX IF NOT EXISTS idx_activity_daily_summary_org_user_date
ON activity_daily_summary(organisation_id, utilisateur_id, activity_date);

-- La validation stricte de chk_time_entries_organisation_id_not_null
-- est faite dans 012_organisation_id_not_null_and_constraints.sql.
