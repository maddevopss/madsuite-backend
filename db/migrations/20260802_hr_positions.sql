BEGIN;

-- Mandat RH 1.A/1.E. "job_title" sur hr_employees est un champ texte libre,
-- sans entité "poste" réelle et sans lien possible vers les compétences
-- requises pour l'occuper. Cette migration crée l'entité poste et sa
-- matrice de compétences requises (section E du mandat : "Matrice des
-- compétences et qualifications par poste"), sans casser job_title
-- (conservé pour compatibilité arrière).
--
-- Pas de colonne department_id ici : hr_departments (PR #712) n'est pas
-- encore fusionnée sur main au moment de cette migration, et y référencer
-- une table absente casserait l'indépendance de ce PR. Le rattachement
-- poste -> département sera ajouté dans une migration de suivi une fois
-- #712 fusionnée.
CREATE TABLE IF NOT EXISTS hr_positions (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  idempotency_key VARCHAR(180) NOT NULL,
  created_by BIGINT REFERENCES utilisateurs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, idempotency_key),
  UNIQUE (organisation_id, code)
);

ALTER TABLE hr_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_positions_org ON hr_positions;
CREATE POLICY hr_positions_org ON hr_positions
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

CREATE TABLE IF NOT EXISTS hr_position_competencies (
  id BIGSERIAL PRIMARY KEY,
  organisation_id BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  position_id BIGINT NOT NULL REFERENCES hr_positions(id) ON DELETE CASCADE,
  competency_id BIGINT NOT NULL REFERENCES hr_competencies(id) ON DELETE CASCADE,
  is_required BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organisation_id, position_id, competency_id)
);

ALTER TABLE hr_position_competencies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_position_competencies_org ON hr_position_competencies;
CREATE POLICY hr_position_competencies_org ON hr_position_competencies
  USING (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT)
  WITH CHECK (organisation_id = NULLIF(current_setting('app.current_organisation_id', true), '')::BIGINT);

ALTER TABLE hr_employees ADD COLUMN IF NOT EXISTS position_id BIGINT REFERENCES hr_positions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_hr_employees_position_id ON hr_employees(organisation_id, position_id);

COMMIT;
