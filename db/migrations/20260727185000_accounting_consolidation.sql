BEGIN;
CREATE TABLE IF NOT EXISTS accounting_consolidation_groups (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  reporting_currency CHAR(3) NOT NULL DEFAULT 'CAD',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,code)
);
CREATE TABLE IF NOT EXISTS accounting_consolidation_members (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  member_organisation_id INTEGER NOT NULL REFERENCES organisations(id),
  ownership_percent NUMERIC(8,4) NOT NULL DEFAULT 100 CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  consolidation_method VARCHAR(24) NOT NULL DEFAULT 'full' CHECK (consolidation_method IN ('full','proportional','equity')),
  effective_from DATE NOT NULL,
  effective_to DATE,
  UNIQUE (organisation_id,group_id,member_organisation_id,effective_from),
  FOREIGN KEY (organisation_id,group_id) REFERENCES accounting_consolidation_groups(organisation_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS accounting_consolidation_runs (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  group_id BIGINT NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','calculated','approved','locked')),
  exchange_rates JSONB NOT NULL DEFAULT '{}'::jsonb,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  elimination_totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key VARCHAR(160) NOT NULL,
  created_by INTEGER REFERENCES utilisateurs(id),
  approved_by INTEGER REFERENCES utilisateurs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  UNIQUE (organisation_id,id), UNIQUE (organisation_id,idempotency_key),
  FOREIGN KEY (organisation_id,group_id) REFERENCES accounting_consolidation_groups(organisation_id,id)
);
CREATE TABLE IF NOT EXISTS accounting_consolidation_eliminations (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  run_id BIGINT NOT NULL,
  elimination_type VARCHAR(32) NOT NULL CHECK (elimination_type IN ('intercompany_receivable','intercompany_payable','intercompany_revenue','intercompany_expense','investment','dividend','other')),
  debit_account_id BIGINT REFERENCES accounting_accounts(id),
  credit_account_id BIGINT REFERENCES accounting_accounts(id),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  FOREIGN KEY (organisation_id,run_id) REFERENCES accounting_consolidation_runs(organisation_id,id) ON DELETE CASCADE
);
ALTER TABLE accounting_consolidation_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_consolidation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_consolidation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_consolidation_eliminations ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_consolidation_groups_org ON accounting_consolidation_groups USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY accounting_consolidation_members_org ON accounting_consolidation_members USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY accounting_consolidation_runs_org ON accounting_consolidation_runs USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY accounting_consolidation_eliminations_org ON accounting_consolidation_eliminations USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
