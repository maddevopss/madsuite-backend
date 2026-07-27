BEGIN;
CREATE TABLE IF NOT EXISTS accounting_close_checklists (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  period_id BIGINT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','ready','closed','reopened')),
  readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  exceptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  prepared_by INTEGER REFERENCES utilisateurs(id),
  reviewed_by INTEGER REFERENCES utilisateurs(id),
  closed_by INTEGER REFERENCES utilisateurs(id),
  prepared_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id,id),
  UNIQUE (organisation_id,period_id),
  FOREIGN KEY (organisation_id,period_id) REFERENCES accounting_periods(organisation_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS accounting_close_tasks (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  checklist_id BIGINT NOT NULL,
  task_code VARCHAR(64) NOT NULL,
  label VARCHAR(180) NOT NULL,
  blocking BOOLEAN NOT NULL DEFAULT TRUE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','waived','failed')),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_by INTEGER REFERENCES utilisateurs(id),
  completed_at TIMESTAMPTZ,
  waiver_reason TEXT,
  UNIQUE (organisation_id,checklist_id,task_code),
  FOREIGN KEY (organisation_id,checklist_id) REFERENCES accounting_close_checklists(organisation_id,id) ON DELETE CASCADE
);
ALTER TABLE accounting_close_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_close_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounting_close_checklists_org ON accounting_close_checklists USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
CREATE POLICY accounting_close_tasks_org ON accounting_close_tasks USING (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER) WITH CHECK (organisation_id=NULLIF(current_setting('app.current_organisation_id',true),'')::INTEGER);
COMMIT;
