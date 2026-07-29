'use strict';

function applySupplierCredit(creditCents, payables = []) {
  if (!Number.isInteger(creditCents) || creditCents <= 0) throw new Error('SUPPLIER_CREDIT_INVALID');
  let remainingCents = creditCents;
  const applications = [...payables]
    .filter((item) => item.balanceCents > 0)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .map((item) => {
      const appliedCents = Math.min(item.balanceCents, remainingCents);
      remainingCents -= appliedCents;
      return { payableId: item.id, appliedCents };
    })
    .filter((item) => item.appliedCents > 0);
  return { creditCents, applications, remainingCreditCents: remainingCents };
}

function buildSupplierCreditEntry(credit, accounts) {
  return {
    reference: `supplier-credit:${credit.id}`,
    idempotencyKey: `supplier-credit:${credit.id}`,
    lines: [
      { accountId: accounts.accountsPayableId, debitCents: credit.amountCents, creditCents: 0 },
      { accountId: accounts.expenseOrAssetId, debitCents: 0, creditCents: credit.amountCents },
    ],
  };
}

module.exports = { applySupplierCredit, buildSupplierCreditEntry };
