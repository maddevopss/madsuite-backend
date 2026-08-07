-- Migration additive de normalisation de la file de quarantaine.
-- La structure fondatrice est créée par 20260802_99_retry_engine_quarantine.sql.
-- Cette migration ne recrée aucune table et reste rejouable.

ALTER TABLE quarantine_queue
  DROP CONSTRAINT IF EXISTS unique_quarantine;

ALTER TABLE quarantine_queue
  DROP CONSTRAINT IF EXISTS quarantine_work_type_id_not_empty;

ALTER TABLE quarantine_queue
  ADD CONSTRAINT quarantine_work_type_id_not_empty
  CHECK (work_type <> '' AND work_id <> '');

ALTER TABLE quarantine_queue
  ADD CONSTRAINT unique_quarantine
  UNIQUE (work_type, work_id);

CREATE INDEX IF NOT EXISTS idx_quarantine_reason ON quarantine_queue(reason);
CREATE INDEX IF NOT EXISTS idx_quarantine_recovery_status ON quarantine_queue(recovery_status);
CREATE INDEX IF NOT EXISTS idx_quarantine_created_at ON quarantine_queue(created_at);
