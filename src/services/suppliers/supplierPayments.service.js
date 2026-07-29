'use strict';

function allocatePayment(payment, bills = []) {
  const amountCents = Number(payment.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Montant de paiement invalide.');
  let remainingCents = amountCents;
  const allocations = [];
  for (const bill of [...bills].sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))) {
    const outstandingCents = Math.max(0, Number(bill.outstandingCents));
    const allocatedCents = Math.min(remainingCents, outstandingCents);
    if (allocatedCents > 0) allocations.push({ supplierBillId: bill.id, amountCents: allocatedCents });
    remainingCents -= allocatedCents;
    if (remainingCents === 0) break;
  }
  if (remainingCents > 0) throw new Error('Le paiement dépasse le solde fournisseur sélectionné.');
  return { ...payment, amountCents, allocations, idempotencyKey: payment.idempotencyKey || `supplier-payment:${payment.supplierId}:${payment.reference}` };
}

module.exports = { allocatePayment };