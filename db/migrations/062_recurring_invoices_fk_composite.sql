-- 062_recurring_invoices_fk_composite.sql
-- Sprint 3 — Renforcement de la FK template_invoice_id avec contrainte composite cross-org
--
-- Contexte (audit multi-tenant 2026-06-24) :
-- La FK template_invoice_id INTEGER REFERENCES invoices(id) est une FK simple.
-- Elle n'empêche pas au niveau DB qu'une recurring_invoice d'org B pointe vers
-- une invoice d'org A. Le guard applicatif (AND r.organisation_id = i.organisation_id)
-- dans recurringInvoiceJob.js compense, mais une contrainte DB est plus robuste.
--
-- Cette migration transforme le guard applicatif en garantie base de données.
-- Prérequis : invoices doit avoir UNIQUE (id, organisation_id) — déjà présent (uq_invoices_id_org).

DO $$
BEGIN
  -- Ajouter la FK composite si elle n'existe pas déjà
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fk_recurring_template_invoice_org'
      AND conrelid = 'recurring_invoices'::regclass
  ) THEN
    ALTER TABLE recurring_invoices
    ADD CONSTRAINT fk_recurring_template_invoice_org
    FOREIGN KEY (template_invoice_id, organisation_id)
    REFERENCES invoices(id, organisation_id)
    ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON CONSTRAINT fk_recurring_template_invoice_org ON recurring_invoices
IS 'FK composite garantissant que template_invoice_id appartient à la même organisation que la récurrence. Transforme le guard applicatif en contrainte DB.';
