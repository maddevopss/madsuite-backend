-- 034_calendar_sync.sql

ALTER TABLE utilisateurs
  ADD COLUMN IF NOT EXISTS ical_feed_url TEXT;

COMMENT ON COLUMN utilisateurs.ical_feed_url IS 'URL secrète iCal (ex: Google Calendar) pour la synchronisation en lecture seule';
