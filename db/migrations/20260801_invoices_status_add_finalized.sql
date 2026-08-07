-- 20260801_invoices_status_add_finalized.sql
-- #310 : POST /invoices/:id/finalize (invoice-finalization.service.js) publie
-- l'écriture comptable de vente et gèle la facture au statut 'finalized', un
-- état intermédiaire distinct de 'sent'/'paid' déjà utilisé pour l'immuabilité
-- (invoice-validation.service.js), l'éligibilité au paiement
-- (invoice-payment-record.service.js) et au lien portail public
-- (invoice-public-link.service.js). La contrainte invoices_status_check n'a
-- jamais été mise à jour pour l'accepter : toute finalisation échouait avec
-- "new row for relation invoices violates check constraint
-- invoices_status_check", ce qui bloquait silencieusement toute facturation
-- réelle malgré un code applicatif complet et cohérent.

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT IF NOT EXISTS invoices_status_check CHECK (status IN ('draft', 'finalized', 'sent', 'paid', 'void'));
