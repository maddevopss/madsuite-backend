-- 094_customer_growth_schema.sql
-- Premier incrément du domaine customer_growth.
-- Crée uniquement le schéma, les contraintes et les politiques RLS.

CREATE TABLE IF NOT EXISTS sales_leads (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  owner_user_id INTEGER,
  created_by INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'qualified', 'unqualified', 'converted', 'archived')),
  display_name VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  email VARCHAR(320),
  phone VARCHAR(64),
  source VARCHAR(100),
  notes TEXT,
  unqualified_reason TEXT,
  archived_reason TEXT,
  converted_client_id INTEGER,
  converted_at TIMESTAMPTZ,
  conversion_idempotency_key VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_sales_leads_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_sales_leads_owner_org
    FOREIGN KEY (owner_user_id, organisation_id)
    REFERENCES utilisateurs(id, organisation_id),
  CONSTRAINT fk_sales_leads_created_by_org
    FOREIGN KEY (created_by, organisation_id)
    REFERENCES utilisateurs(id, organisation_id),
  CONSTRAINT fk_sales_leads_converted_client_org
    FOREIGN KEY (converted_client_id, organisation_id)
    REFERENCES clients(id, organisation_id),
  CONSTRAINT chk_sales_leads_conversion_state CHECK (
    (status = 'converted' AND converted_client_id IS NOT NULL AND converted_at IS NOT NULL)
    OR
    (status <> 'converted' AND converted_client_id IS NULL AND converted_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_leads_conversion_idempotency
  ON sales_leads (organisation_id, conversion_idempotency_key)
  WHERE conversion_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_leads_org_status
  ON sales_leads (organisation_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_leads_org_owner
  ON sales_leads (organisation_id, owner_user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_leads_org_email
  ON sales_leads (organisation_id, lower(email))
  WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE TABLE IF NOT EXISTS sales_opportunities (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  lead_id INTEGER,
  client_id INTEGER,
  owner_user_id INTEGER,
  created_by INTEGER,
  status VARCHAR(32) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'abandoned')),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  estimated_value NUMERIC(14, 2) CHECK (estimated_value IS NULL OR estimated_value >= 0),
  probability SMALLINT CHECK (probability IS NULL OR probability BETWEEN 0 AND 100),
  expected_close_date DATE,
  lost_reason TEXT,
  abandoned_reason TEXT,
  produced_project_id INTEGER,
  produced_estimate_id INTEGER,
  conversion_idempotency_key VARCHAR(128),
  won_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_sales_opportunities_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_sales_opportunities_lead_org
    FOREIGN KEY (lead_id, organisation_id)
    REFERENCES sales_leads(id, organisation_id),
  CONSTRAINT fk_sales_opportunities_client_org
    FOREIGN KEY (client_id, organisation_id)
    REFERENCES clients(id, organisation_id),
  CONSTRAINT fk_sales_opportunities_owner_org
    FOREIGN KEY (owner_user_id, organisation_id)
    REFERENCES utilisateurs(id, organisation_id),
  CONSTRAINT fk_sales_opportunities_created_by_org
    FOREIGN KEY (created_by, organisation_id)
    REFERENCES utilisateurs(id, organisation_id),
  CONSTRAINT fk_sales_opportunities_project_org
    FOREIGN KEY (produced_project_id, organisation_id)
    REFERENCES projets(id, organisation_id),
  CONSTRAINT fk_sales_opportunities_estimate_org
    FOREIGN KEY (produced_estimate_id, organisation_id)
    REFERENCES estimates(id, organisation_id),
  CONSTRAINT chk_sales_opportunities_origin CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL),
  CONSTRAINT chk_sales_opportunities_closed_state CHECK (
    (status = 'won' AND won_at IS NOT NULL AND closed_at IS NOT NULL)
    OR
    (status IN ('lost', 'abandoned') AND closed_at IS NOT NULL)
    OR
    (status NOT IN ('won', 'lost', 'abandoned') AND won_at IS NULL AND closed_at IS NULL)
  ),
  CONSTRAINT chk_sales_opportunities_lost_reason CHECK (
    status <> 'lost' OR lost_reason IS NOT NULL
  ),
  CONSTRAINT chk_sales_opportunities_abandoned_reason CHECK (
    status <> 'abandoned' OR abandoned_reason IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_opportunities_conversion_idempotency
  ON sales_opportunities (organisation_id, conversion_idempotency_key)
  WHERE conversion_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_org_status
  ON sales_opportunities (organisation_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_org_owner
  ON sales_opportunities (organisation_id, owner_user_id)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sales_opportunities_org_close_date
  ON sales_opportunities (organisation_id, expected_close_date)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS sales_activities (
  id SERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  lead_id INTEGER,
  opportunity_id INTEGER,
  created_by INTEGER,
  activity_type VARCHAR(32) NOT NULL
    CHECK (activity_type IN ('call', 'email', 'meeting', 'note', 'task')),
  task_status VARCHAR(32)
    CHECK (task_status IS NULL OR task_status IN ('pending', 'completed', 'cancelled')),
  subject VARCHAR(255) NOT NULL,
  details TEXT,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMPTZ,
  CONSTRAINT uq_sales_activities_id_org UNIQUE (id, organisation_id),
  CONSTRAINT fk_sales_activities_lead_org
    FOREIGN KEY (lead_id, organisation_id)
    REFERENCES sales_leads(id, organisation_id),
  CONSTRAINT fk_sales_activities_opportunity_org
    FOREIGN KEY (opportunity_id, organisation_id)
    REFERENCES sales_opportunities(id, organisation_id),
  CONSTRAINT fk_sales_activities_created_by_org
    FOREIGN KEY (created_by, organisation_id)
    REFERENCES utilisateurs(id, organisation_id),
  CONSTRAINT chk_sales_activities_single_parent CHECK (
    (lead_id IS NOT NULL AND opportunity_id IS NULL)
    OR
    (lead_id IS NULL AND opportunity_id IS NOT NULL)
  ),
  CONSTRAINT chk_sales_activities_task_state CHECK (
    (activity_type = 'task' AND task_status IS NOT NULL)
    OR
    (activity_type <> 'task' AND task_status IS NULL)
  ),
  CONSTRAINT chk_sales_activities_completed_at CHECK (
    task_status <> 'completed' OR completed_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_sales_activities_org_lead
  ON sales_activities (organisation_id, lead_id, created_at DESC)
  WHERE deleted_at IS NULL AND lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_activities_org_opportunity
  ON sales_activities (organisation_id, opportunity_id, created_at DESC)
  WHERE deleted_at IS NULL AND opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_activities_org_due
  ON sales_activities (organisation_id, due_at)
  WHERE deleted_at IS NULL AND activity_type = 'task' AND task_status = 'pending';

ALTER TABLE sales_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_leads FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_leads_org_isolation ON sales_leads;
CREATE POLICY sales_leads_org_isolation ON sales_leads
  USING (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer
  )
  WITH CHECK (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer
  );

ALTER TABLE sales_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_opportunities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_opportunities_org_isolation ON sales_opportunities;
CREATE POLICY sales_opportunities_org_isolation ON sales_opportunities
  USING (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer
  )
  WITH CHECK (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer
  );

ALTER TABLE sales_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_activities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_activities_org_isolation ON sales_activities;
CREATE POLICY sales_activities_org_isolation ON sales_activities
  USING (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer
  )
  WITH CHECK (
    organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::integer
  );

COMMENT ON TABLE sales_leads IS 'Prospects commerciaux isolés par organisation.';
COMMENT ON TABLE sales_opportunities IS 'Opportunités commerciales isolées par organisation.';
COMMENT ON TABLE sales_activities IS 'Activités commerciales liées à un prospect ou une opportunité.';
