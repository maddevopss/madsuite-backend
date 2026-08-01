-- MADSuite — le déclencheur d'immuabilité des factures fournisseur
-- (063_posted_source_immutability.sql) n'autorisait que la progression
-- d'un paiement (approved -> partially_paid -> paid) mais bloquait toute
-- transition arrière, ce qui empêchait totalement :
--   - le renversement d'un paiement (payment-reversal.service.js), qui doit
--     pouvoir ramener une facture de paid/partially_paid vers un état moins
--     payé ;
--   - l'annulation d'une facture approuvée sans paiement actif
--     (supplier-bill-lifecycle.service.js voidSupplierBill), dont la seule
--     transition valide (approved -> void) n'était pas dans la liste
--     autorisée.
-- Les deux opérations sont des corrections légitimes déjà gouvernées par
-- leurs propres règles métier (raison obligatoire, idempotence, blocage si
-- des paiements/crédits actifs subsistent) ; seule la contrainte au niveau
-- base de données était trop stricte.

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
      OR (OLD.status = 'approved' AND NEW.status IN ('partially_paid', 'paid', 'void'))
      OR (OLD.status = 'partially_paid' AND NEW.status IN ('approved', 'paid', 'void'))
      OR (OLD.status = 'paid' AND NEW.status IN ('approved', 'partially_paid', 'void'))
    ) THEN
      RAISE EXCEPTION 'Transition de statut fournisseur invalide.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
