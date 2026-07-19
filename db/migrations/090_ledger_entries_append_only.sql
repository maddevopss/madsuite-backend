CREATE TABLE IF NOT EXISTS ledger_maintenance_audit (
  id BIGSERIAL PRIMARY KEY,
  ledger_entry_id BIGINT,
  organisation_id BIGINT,
  operation TEXT NOT NULL CHECK (operation IN ('UPDATE', 'DELETE')),
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  database_user TEXT NOT NULL DEFAULT CURRENT_USER,
  previous_row JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_maintenance_audit_entry
  ON ledger_maintenance_audit (ledger_entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_maintenance_audit_organisation
  ON ledger_maintenance_audit (organisation_id, created_at DESC);

CREATE OR REPLACE FUNCTION enforce_ledger_entries_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  maintenance_mode TEXT := COALESCE(current_setting('app.ledger_maintenance_mode', true), 'off');
  maintenance_actor TEXT := NULLIF(BTRIM(COALESCE(current_setting('app.ledger_maintenance_actor', true), '')), '');
  maintenance_reason TEXT := NULLIF(BTRIM(COALESCE(current_setting('app.ledger_maintenance_reason', true), '')), '');
BEGIN
  IF maintenance_mode <> 'on' THEN
    RAISE EXCEPTION 'ledger_entries est append-only: % interdit', TG_OP
      USING ERRCODE = 'P0001';
  END IF;

  IF maintenance_actor IS NULL OR maintenance_reason IS NULL THEN
    RAISE EXCEPTION 'maintenance ledger refusée: actor et reason sont obligatoires'
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO ledger_maintenance_audit (
    ledger_entry_id,
    organisation_id,
    operation,
    actor,
    reason,
    database_user,
    previous_row
  )
  VALUES (
    OLD.id,
    OLD.organisation_id,
    TG_OP,
    maintenance_actor,
    maintenance_reason,
    CURRENT_USER,
    TO_JSONB(OLD)
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_entries_append_only ON ledger_entries;

CREATE TRIGGER trg_ledger_entries_append_only
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION enforce_ledger_entries_append_only();

COMMENT ON TABLE ledger_maintenance_audit IS
  'Trace durable de toute mutation exceptionnelle autorisée sur le ledger append-only.';

COMMENT ON FUNCTION enforce_ledger_entries_append_only() IS
  'Interdit UPDATE/DELETE sur ledger_entries sauf maintenance explicite avec actor et reason, puis journalise la mutation.';
