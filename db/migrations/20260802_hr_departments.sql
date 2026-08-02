BEGIN;

-- Mandat RH 1.A/1.B (structure organisationnelle) : hr_employees porte déjà
-- manager_employee_id (hiérarchie individuelle) mais "department" n'est
-- qu'un champ texte libre, pas une entité réelle -- aucune fondation
-- existante pour un organigramme départemental. Cette migration crée
-- l'entité et rattache les employés sans casser le champ texte existant
-- (conservé pour compatibilité arrière, non utilisé par les nouvelles
-- routes).
CREATE TABLE IF NOT EXISTS hr_departments (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  parent_department_id BIGINT REFERENCES hr_departments(id) ON DELETE SET NULL,
  manager_employee_id BIGINT REFERENCES hr_employees(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  idempotency_key VARCHAR(180) NOT NULL,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key),
  UNIQUE (organisation_id, code),
  CHECK (parent_department_id IS NULL OR parent_department_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_hr_departments_parent ON hr_departments(organisation_id, parent_department_id);

ALTER TABLE hr_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_departments_org ON hr_departments;
CREATE POLICY hr_departments_org ON hr_departments
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS department_id BIGINT REFERENCES hr_departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hr_employees_department_id ON hr_employees(organisation_id, department_id);

COMMIT;
