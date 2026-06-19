-- 033_project_budgets.sql

ALTER TABLE projets 
  ADD COLUMN IF NOT EXISTS budget_hours DECIMAL(10, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS budget_amount DECIMAL(12, 2) DEFAULT 0;

COMMENT ON COLUMN projets.budget_hours IS 'Budget en heures pour le projet (0 = pas de budget)';
COMMENT ON COLUMN projets.budget_amount IS 'Budget en montant ($) pour le projet (0 = pas de budget)';
