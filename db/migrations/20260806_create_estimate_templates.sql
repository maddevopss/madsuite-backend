-- Migration: Create estimate templates table
-- Date: 2026-08-06
-- Purpose: Support for estimate templates
-- FIXED: Changed UUID to INTEGER to match organisations.id type, added RLS

BEGIN;

CREATE TABLE IF NOT EXISTS estimate_templates (
  id BIGSERIAL PRIMARY KEY,
  organisation_id INTEGER NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  template_name VARCHAR(255) NOT NULL,
  description TEXT,
  content JSONB NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  created_by INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_estimate_templates_org ON estimate_templates(organisation_id);
CREATE INDEX IF NOT EXISTS idx_estimate_templates_org_default ON estimate_templates(organisation_id, is_default);
CREATE INDEX IF NOT EXISTS idx_estimate_templates_created_by ON estimate_templates(created_by);

-- RLS Policy
ALTER TABLE estimate_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY estimate_templates_org_isolation ON estimate_templates
  USING (organisation_id = current_setting('app.current_organisation_id')::INTEGER);

-- Trigger for updated_at
CREATE TRIGGER estimate_templates_updated_at
  BEFORE UPDATE ON estimate_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;
