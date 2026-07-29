'use strict';

function applySupplierCredit(credit, bills = []) {
  let remainingCents = Number(credit.amountCents);
  if (!Number.isInteger(remainingCents) || remainingCents <= 0) throw new Error('Montant de crédit invalide.');
  const allocations = [];
  for (const bill of bills) {
    const appliedCents = Math.min(remainingCents, Number(bill.outstandingCents || 0));
    if (appliedCents > 0) allocations.push({ supplierBillId: bill.id, appliedCents });
    remainingCents -= appliedCents;
    if (remainingCents === 0) break;
  }
  return { ...credit, allocations, unappliedCents: remainingCents };
}

module.exports = { applySupplierCredit };