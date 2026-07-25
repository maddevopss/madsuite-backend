-- MADSuite — phases A à D : paiements fournisseurs, registre d'événements et projections.

CREATE TABLE IF NOT EXISTS supplier_payments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_bill_id BIGINT NOT NULL REFERENCES supplier_bills(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payment_method VARCHAR(32),
  reference VARCHAR(120),
  idempotency_key VARCHAR(120) NOT NULL,
  accounting_entry_id BIGINT REFERENCES accounting_entries(id),
  reversed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_bill
  ON supplier_payments (organisation_id, supplier_bill_id, paid_at);

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounting_source_active
  ON accounting_entries (organisation_id, source_type, source_id)
  WHERE status <> 'reversed' AND source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS business_events (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL DEFAULT gen_random_uuid(),
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  aggregate_type VARCHAR(80) NOT NULL,
  aggregate_id VARCHAR(120) NOT NULL,
  aggregate_version INTEGER NOT NULL DEFAULT 1 CHECK (aggregate_version > 0),
  source VARCHAR(80) NOT NULL DEFAULT 'backend',
  actor_user_id INTEGER REFERENCES utilisateurs(id),
  correlation_id UUID,
  causation_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_hash VARCHAR(64) NOT NULL,
  UNIQUE (event_id),
  UNIQUE (organisation_id, aggregate_type, aggregate_id, aggregate_version),
  UNIQUE (organisation_id, event_hash)
);

CREATE INDEX IF NOT EXISTS idx_business_events_stream
  ON business_events (organisation_id, aggregate_type, aggregate_id, aggregate_version);
CREATE INDEX IF NOT EXISTS idx_business_events_type_time
  ON business_events (organisation_id, event_type, occurred_at DESC);

CREATE TABLE IF NOT EXISTS business_projection_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  projection_name VARCHAR(100) NOT NULL,
  last_event_id BIGINT REFERENCES business_events(id),
  last_recorded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, projection_name)
);

CREATE TABLE IF NOT EXISTS financial_daily_projections (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  projection_date DATE NOT NULL,
  invoiced NUMERIC(14,2) NOT NULL DEFAULT 0,
  customer_payments NUMERIC(14,2) NOT NULL DEFAULT 0,
  supplier_bills NUMERIC(14,2) NOT NULL DEFAULT 0,
  supplier_payments NUMERIC(14,2) NOT NULL DEFAULT 0,
  expenses NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_cash_flow NUMERIC(14,2) NOT NULL DEFAULT 0,
  source_event_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, projection_date)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'supplier_payments','business_events','business_projection_checkpoints','financial_daily_projections'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS organisation_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY organisation_isolation ON %I USING (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int) WITH CHECK (organisation_id = NULLIF(current_setting(''app.current_organisation_id'', true), '''')::int)', t
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION prevent_business_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le registre des événements métier est immuable.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS business_events_append_only ON business_events;
CREATE TRIGGER business_events_append_only
BEFORE UPDATE OR DELETE ON business_events
FOR EACH ROW EXECUTE FUNCTION prevent_business_event_mutation();
