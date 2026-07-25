BEGIN;

ALTER TABLE accounting_periods
  ADD COLUMN IF NOT EXISTS close_reason TEXT,
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reopened_by BIGINT,
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

ALTER TABLE accounting_entries
  ADD COLUMN IF NOT EXISTS period_id BIGINT REFERENCES accounting_periods(id),
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS adjustment_kind VARCHAR(32),
  ADD COLUMN IF NOT EXISTS reversal_of_entry_id BIGINT REFERENCES accounting_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_by_entry_id BIGINT REFERENCES accounting_entries(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_entries_idempotency
  ON accounting_entries (organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_entries_period
  ON accounting_entries (organisation_id, period_id, entry_date, id);

CREATE OR REPLACE FUNCTION enforce_accounting_period_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  configured_count INTEGER;
  target_period accounting_periods%ROWTYPE;
BEGIN
  SELECT COUNT(*) INTO configured_count
  FROM accounting_periods
  WHERE organisation_id = NEW.organisation_id;

  IF configured_count = 0 THEN
    NEW.period_id := NULL;
    RETURN NEW;
  END IF;

  SELECT * INTO target_period
  FROM accounting_periods
  WHERE organisation_id = NEW.organisation_id
    AND NEW.entry_date BETWEEN starts_on AND ends_on
  ORDER BY starts_on DESC
  LIMIT 1;

  IF target_period.id IS NULL THEN
    RAISE EXCEPTION 'Aucune période comptable ne couvre la date %.', NEW.entry_date
      USING ERRCODE = '23514';
  END IF;

  IF target_period.status <> 'open' THEN
    RAISE EXCEPTION 'La période comptable couvrant la date % est fermée.', NEW.entry_date
      USING ERRCODE = '23514';
  END IF;

  NEW.period_id := target_period.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_period_guard ON accounting_entries;
CREATE TRIGGER trg_accounting_period_guard
BEFORE INSERT OR UPDATE OF entry_date, status
ON accounting_entries
FOR EACH ROW
EXECUTE FUNCTION enforce_accounting_period_guard();

CREATE OR REPLACE FUNCTION prevent_accounting_period_overlap()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM accounting_periods p
    WHERE p.organisation_id = NEW.organisation_id
      AND p.id <> COALESCE(NEW.id, 0)
      AND daterange(p.starts_on, p.ends_on, '[]') && daterange(NEW.starts_on, NEW.ends_on, '[]')
  ) THEN
    RAISE EXCEPTION 'Les périodes comptables ne peuvent pas se chevaucher.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounting_period_no_overlap ON accounting_periods;
CREATE TRIGGER trg_accounting_period_no_overlap
BEFORE INSERT OR UPDATE OF starts_on, ends_on
ON accounting_periods
FOR EACH ROW
EXECUTE FUNCTION prevent_accounting_period_overlap();

COMMIT;
