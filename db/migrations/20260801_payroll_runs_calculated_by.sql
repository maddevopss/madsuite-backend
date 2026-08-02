-- 20260801_payroll_runs_calculated_by.sql
-- Suite de #698 (lacune documentée : payroll-approval-policy.service.js —
-- prévention d'auto-approbation, jusqu'ici jamais câblée). transitionRun
-- (action 'approve') n'a aucun moyen de savoir qui a préparé/calculé le
-- cycle : payroll_runs traçait déjà approved_by/paid_by/voided_by/corrected_by
-- mais pas calculated_by. Sans cette colonne, un admin peut préparer ET
-- approuver le même cycle sans qu'aucun contrôle ne le détecte.

ALTER TABLE payroll_runs
  ADD COLUMN IF NOT EXISTS calculated_by INTEGER REFERENCES utilisateurs(id);
