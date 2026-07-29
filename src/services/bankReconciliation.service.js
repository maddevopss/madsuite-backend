'use strict';

function cents(value) {
  if (!Number.isInteger(value)) throw new Error('BANK_AMOUNT_MUST_BE_CENTS');
  return value;
}

function matchTransaction(bankTransaction, ledgerEntries = [], toleranceCents = 0) {
  cents(bankTransaction.amountCents);
  const candidates = ledgerEntries.filter((entry) => {
    const amountGap = Math.abs(cents(entry.amountCents) - bankTransaction.amountCents);
    const referenceMatch = bankTransaction.reference && entry.reference === bankTransaction.reference;
    return amountGap <= toleranceCents || referenceMatch;
  });
  return candidates.sort((a, b) => Math.abs(a.amountCents - bankTransaction.amountCents) - Math.abs(b.amountCents - bankTransaction.amountCents));
}

function reconcile(statementBalanceCents, bookBalanceCents, outstanding = []) {
  const adjustments = outstanding.reduce((total, item) => total + cents(item.amountCents), 0);
  const adjustedBookBalanceCents = cents(bookBalanceCents) + adjustments;
  return {
    statementBalanceCents: cents(statementBalanceCents),
    adjustedBookBalanceCents,
    differenceCents: statementBalanceCents - adjustedBookBalanceCents,
    reconciled: statementBalanceCents === adjustedBookBalanceCents,
  };
}

module.exports = { matchTransaction, reconcile };
