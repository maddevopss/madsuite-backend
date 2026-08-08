-- 20260801_payroll_runs_correction.sql
-- #318 (paie) écart 5 : l'annulation (void) existe seulement avant paiement ; aucun
-- flux de correction/renversement traçable n'existe pour un cycle déjà payé. Ajoute
-- un statut 'corrected' distinct (plutôt que de réutiliser 'void', qui signifie une
-- annulation avant paiement) et les colonnes de traçabilité correspondantes, pour
-- que la correction d'un cycle payé renverse son écriture comptable publiée (via
-- accounting-reversal-governance.service.js, déjà gouverné et idempotent) et laisse
-- une trace distincte de l'annulation pré-paiement.

ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE payroll_runs ADD CONSTRAINT IF NOT EXISTS payroll_runs_status_check CHECK (status IN ('draft', 'calculated', 'approved', 'paid', 'void', 'corrected'));

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS corrected_by INTEGER REFERENCES utilisateurs(id),
  ADD COLUMN IF NOT EXISTS correction_reason TEXT,
  ADD COLUMN IF NOT EXISTS correction_idempotency_key VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_runs_correction_idempotency
  ON payroll_runs (organisation_id, correction_idempotency_key)
  WHERE correction_idempotency_key IS NOT NULL;
