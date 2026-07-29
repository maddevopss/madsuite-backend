'use strict';

function dueDateFromTerms(billDate, termsDays = 30) {
  const date = new Date(`${billDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error('Date de facture invalide.');
  const days = Number(termsDays);
  if (!Number.isInteger(days) || days < 0 || days > 365) throw new Error('Conditions de paiement invalides.');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeTerms(input = {}) {
  return {
    paymentTermsDays: Number(input.paymentTermsDays ?? 30),
    earlyDiscountPercent: Number(input.earlyDiscountPercent ?? 0),
    earlyDiscountDays: Number(input.earlyDiscountDays ?? 0),
    lateFeePercent: Number(input.lateFeePercent ?? 0),
  };
}

module.exports = { dueDateFromTerms, normalizeTerms };