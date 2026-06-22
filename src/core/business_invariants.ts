export const BUSINESS_INVARIANTS = {
  invoice_immutability_lock: {
    description: "Lorsqu'une facture est créée, les time_entries et expenses associés sont immédiatement verrouillés.",
    check_logic: "IF invoice exists THEN FOR ALL related time_entries/expenses (is_billed == TRUE AND invoice_id IS NOT NULL)",
    severity: "HIGH"
  },
  invoice_idempotency: {
    description: "La création de facture accepte un idempotencyKey pour éviter qu'une requête réseau dupliquée ne génère deux factures distinctes.",
    check_logic: "count(invoices) WHERE idempotency_key = X MUST BE <= 1",
    severity: "HIGH"
  },
  estimate_to_invoice_propagation: {
    description: "Une facture créée à partir d'une soumission ne lie pas d'entrées de temps mais copie textuellement les lignes.",
    check_logic: "IF invoice.source == 'estimate' THEN FOR ALL invoice_lines (time_entry_id IS NULL)",
    severity: "MEDIUM"
  },
  append_only_ledger: {
    description: "Toute transaction financière crée une ligne immuable dans ledger_entries. Le ledger ne met jamais à jour une ligne existante.",
    check_logic: "UPDATE ON ledger_entries MUST BE PREVENTED (append-only)",
    severity: "HIGH"
  },
  invoice_paid_implies_ledger_entry: {
    description: "L'état status = 'paid' d'une facture implique qu'au moins une entrée correspondante existe dans le Ledger.",
    check_logic: "IF invoice.status == 'paid' THEN count(ledger_entries) WHERE reference_id = invoice.id MUST BE > 0",
    severity: "HIGH"
  },
  stripe_webhook_idempotency: {
    description: "Les événements Stripe sont enregistrés dans payment_events avec une contrainte d'unicité sur stripe_event_id.",
    check_logic: "count(payment_events) WHERE stripe_event_id = X MUST BE <= 1",
    severity: "MEDIUM"
  },
  stripe_payment_propagation: {
    description: "Un paiement réussi via Stripe force l'état de la facture à paid, marque ses time_entries comme confirmées/payées, et crée une entrée Ledger.",
    check_logic: "IF payment_event.status == 'succeeded' THEN invoice.status == 'paid' AND ledger_entries HAS EVENT",
    severity: "HIGH"
  },
  auto_sent_recurring_invoices: {
    description: "Une facture générée par le système de récurrence est créée directement avec le statut sent.",
    check_logic: "IF invoice.is_recurring_generated == TRUE THEN invoice.status MUST BE 'sent' OR 'paid' (NOT 'draft')",
    severity: "HIGH"
  },
  recurring_generation_atomicity: {
    description: "La génération de la facture, la mise à jour de la prochaine date, et l'insertion dans l'Outbox se font dans la même transaction.",
    check_logic: "invoice_creation AND recurring_config.next_issue_date_update AND outbox_insert MUST HAPPEN IN ONE TRANSACTION",
    severity: "HIGH"
  },
  dunning_escalation_staircase: {
    description: "Les relances suivent des paliers stricts basés sur les jours de retard et le nombre de relances précédentes.",
    check_logic: "IF reminder.level == 'firm' THEN previous_reminders MUST INCLUDE 'gentle'",
    severity: "MEDIUM"
  },
  dunning_only_for_overdue_invoices: {
    description: "Le Dunning n'opère que sur les factures au statut sent avec une due_date dépassée.",
    check_logic: "IF dunning_action_created THEN invoice.status == 'sent' AND invoice.due_date < NOW()",
    severity: "HIGH"
  },
  mrr_snapshot_consistency: {
    description: "L'agrégation des métriques utilise ON CONFLICT pour garantir un seul snapshot par jour par organisation.",
    check_logic: "count(snapshots) WHERE organisation_id = X AND date = Y MUST BE <= 1",
    severity: "HIGH"
  },
  historical_static_truth: {
    description: "Un snapshot représente la vérité à l'instant T. Il n'est pas recalculé si des données passées changent.",
    check_logic: "snapshot(date).value DOES NOT CHANGE AFTER date HAS PASSED",
    severity: "MEDIUM"
  },
  outbox_at_least_once_delivery: {
    description: "Le système garantit l'envoi au minimum une fois. Si le worker plante, l'email sera renvoyé.",
    check_logic: "IF event.status != 'completed' AND worker_crashed THEN event MUST BE RETRIED",
    severity: "HIGH"
  },
  outbox_concurrent_processing_protection: {
    description: "Le worker utilise FOR UPDATE SKIP LOCKED pour éviter que deux workers traitent le même événement.",
    check_logic: "outbox_worker_query MUST INCLUDE 'FOR UPDATE SKIP LOCKED'",
    severity: "HIGH"
  },
  outbox_stuck_event_recovery: {
    description: "Les événements en statut processing depuis plus de 15 minutes sont remis en statut pending.",
    check_logic: "IF outbox_event.status == 'processing' AND updated_at < NOW() - 15m THEN outbox_event.status = 'pending'",
    severity: "HIGH"
  }
};
