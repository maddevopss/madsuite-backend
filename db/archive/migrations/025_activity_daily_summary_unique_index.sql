-- Migration 025: prépare activity_daily_summary pour l'upsert du job d'agrégation

-- Normalise les anciennes lignes qui peuvent encore avoir des valeurs nulles.
UPDATE activity_daily_summary
SET
  app_name = COALESCE(app_name, ''),
  window_title = COALESCE(window_title, '')
WHERE app_name IS NULL
   OR window_title IS NULL;

-- Élimine les doublons éventuels avant de poser la contrainte unique.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY utilisateur_id, organisation_id, app_name, window_title, activity_date
      ORDER BY id
    ) AS rn
  FROM activity_daily_summary
)
DELETE FROM activity_daily_summary ads
USING ranked r
WHERE ads.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_daily_summary_unique_scope
ON activity_daily_summary (
  utilisateur_id,
  organisation_id,
  app_name,
  window_title,
  activity_date
);
