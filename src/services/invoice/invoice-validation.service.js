function validateSelectionCount(entries, expenses, requestedEntryIds, requestedExpenseIds) {
  if (entries.length === 0 && expenses.length === 0) {
    const err = new Error("Aucune entrée de temps ou dépense sélectionnable pour ce client.");
    err.statusCode = 400;
    throw err;
  }

  if (entries.length !== requestedEntryIds.length) {
    const err = new Error("Certaines entrées de temps sont invalides, déjà facturées ou hors organisation.");
    err.statusCode = 400;
    throw err;
  }

  if (expenses.length !== requestedExpenseIds.length) {
    const err = new Error("Certaines dépenses sont invalides ou déjà facturées.");
    err.statusCode = 400;
    throw err;
  }
}

function validateTransition(currentStatus, targetStatus) {
  const allowedTransitions = {
    draft: ["draft", "finalized", "sent", "paid", "void"],
    finalized: ["finalized", "sent", "paid", "void"],
    sent: ["sent", "paid", "void"],
    paid: ["paid", "void"],
    void: ["void"],
  };

  if (!allowedTransitions[currentStatus]?.includes(targetStatus)) {
    const err = new Error(`Transition de statut invalide: ${currentStatus} vers ${targetStatus}.`);
    err.statusCode = 409;
    throw err;
  }
}

function checkInvoiceModification(invoice, updates) {
  const isFrozen = ["finalized", "sent", "paid"].includes(invoice.status);
  if (isFrozen && (updates.issue_date !== undefined || updates.due_date !== undefined || updates.notes !== undefined)) {
    const err = new Error("Une facture finalisée ne peut pas être modifiée.");
    err.statusCode = 409;
    throw err;
  }
}

module.exports = {
  validateSelectionCount,
  validateTransition,
  checkInvoiceModification
};
