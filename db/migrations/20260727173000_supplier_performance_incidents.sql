-- MADSuite — performance, incidents et renouvellement fournisseurs

CREATE TABLE IF NOT EXISTS supplier_incidents (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL,
  incident_number VARCHAR(80) NOT NULL,
  incident_type VARCHAR(40) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','corrective_action','resolved','closed')),
  occurred_at TIMESTAMPTZ NOT NULL,
  due_at TIMESTAMPTZ,
  corrective_action TEXT,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_user_id INTEGER REFERENCES utilisateurs(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,incident_number),
  FOREIGN KEY (organisation_id,supplier_id) REFERENCES suppliers(organisation_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_performance_snapshots (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  on_time_delivery_rate NUMERIC(8,4),
  rejection_rate NUMERIC(8,4),
  invoice_exception_rate NUMERIC(8,4),
  compliance_score NUMERIC(8,4),
  incident_score NUMERIC(8,4),
  spend_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  spend_concentration_rate NUMERIC(8,4),
  overall_score NUMERIC(8,4) NOT NULL,
  score_explanation JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,supplier_id,period_start,period_end),
  FOREIGN KEY (organisation_id,supplier_id) REFERENCES suppliers(organisation_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS supplier_reviews (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL,
  review_date DATE NOT NULL,
  review_type VARCHAR(24) NOT NULL DEFAULT 'periodic',
  decision VARCHAR(24) NOT NULL CHECK (decision IN ('renew','renew_with_conditions','probation','suspend','terminate')),
  rationale TEXT NOT NULL,
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_review_at DATE,
  reviewed_by INTEGER REFERENCES utilisateurs(id),
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,idempotency_key),
  FOREIGN KEY (organisation_id,supplier_id) REFERENCES suppliers(organisation_id,id) ON DELETE CASCADE
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_performance_score NUMERIC(8,4);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_review_at DATE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS next_review_at DATE;

ALTER TABLE supplier_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_performance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_incidents_org ON supplier_incidents USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY supplier_performance_snapshots_org ON supplier_performance_snapshots USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY supplier_reviews_org ON supplier_reviews USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
