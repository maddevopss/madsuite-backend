BEGIN;
CREATE TABLE IF NOT EXISTS supplier_payment_forecasts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  forecast_date DATE NOT NULL,
  horizon_days INTEGER NOT NULL DEFAULT 30 CHECK (horizon_days > 0),
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  due_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  overdue_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_opportunity NUMERIC(14,2) NOT NULL DEFAULT 0,
  recommended_payment_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  available_cash NUMERIC(14,2),
  risk_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_hash VARCHAR(128) NOT NULL,
  locked_at TIMESTAMPTZ,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,forecast_date,horizon_days,source_hash)
);
ALTER TABLE supplier_payment_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_payment_forecasts_org ON supplier_payment_forecasts USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::BIGINT);
COMMIT;