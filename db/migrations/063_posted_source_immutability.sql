-- MADSuite — une pièce source comptabilisée ne peut plus être modifiée silencieusement.

CREATE OR REPLACE FUNCTION prevent_posted_expense_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.accounting_status = 'posted' THEN
    RAISE EXCEPTION 'Une dépense comptabilisée est immuable; utilisez un renversement.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS expenses_immutable_when_posted ON expenses;
CREATE TRIGGER expenses_immutable_when_posted
BEFORE UPDATE OR DELETE ON expenses
FOR EACH ROW EXECUTE FUNCTION prevent_posted_expense_mutation();

CREATE OR REPLACE FUNCTION prevent_approved_supplier_bill_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('approved', 'partially_paid', 'paid') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Une facture fournisseur approuvée est immuable; utilisez un renversement.';
    END IF;

    IF ROW(
      NEW.organisation_id, NEW.supplier_id, NEW.bill_number, NEW.bill_date,
      NEW.due_date, NEW.subtotal, NEW.tax_total, NEW.total,
      NEW.accounting_entry_id, NEW.created_at
    ) IS DISTINCT FROM ROW(
      OLD.organisation_id, OLD.supplier_id, OLD.bill_number, OLD.bill_date,
      OLD.due_date, OLD.subtotal, OLD.tax_total, OLD.total,
      OLD.accounting_entry_id, OLD.created_at
    ) THEN
      RAISE EXCEPTION 'Les montants et références d’une facture fournisseur approuvée sont immuables.';
    END IF;

    IF NOT (
      NEW.status = OLD.status
      OR (OLD.status = 'approved' AND NEW.status IN ('partially_paid', 'paid'))
      OR (OLD.status = 'partially_paid' AND NEW.status = 'paid')
    ) THEN
      RAISE EXCEPTION 'Transition de statut fournisseur invalide.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplier_bills_immutable_when_approved ON supplier_bills;
CREATE TRIGGER supplier_bills_immutable_when_approved
BEFORE UPDATE OR DELETE ON supplier_bills
FOR EACH ROW EXECUTE FUNCTION prevent_approved_supplier_bill_mutation();
