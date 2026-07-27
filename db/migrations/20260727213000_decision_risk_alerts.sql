BEGIN;
CREATE TABLE IF NOT EXISTS decision_risk_alerts (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  alert_code VARCHAR(80) NOT NULL,
  domain VARCHAR(40) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('info','warning','critical')),
  title VARCHAR(180) NOT NULL,
  explanation TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  recommended_action TEXT,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  idempotency_key VARCHAR(160) NOT NULL,
  UNIQUE (organisation_id, idempotency_key)
);
COMMIT;