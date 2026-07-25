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
    RAISE EXCEPTION 'Une facture fournisseur approuvée est immuable; utilisez un renversement.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS supplier_bills_immutable_when_approved ON supplier_bills;
CREATE TRIGGER supplier_bills_immutable_when_approved
BEFORE UPDATE OR DELETE ON supplier_bills
FOR EACH ROW EXECUTE FUNCTION prevent_approved_supplier_bill_mutation();
