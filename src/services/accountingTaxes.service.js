'use strict';

function assertRate(rate) {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('ACCOUNTING_TAX_RATE_INVALID');
}

function calculateTax(amountCents, rate) {
  if (!Number.isInteger(amountCents)) throw new Error('ACCOUNTING_TAX_AMOUNT_MUST_BE_CENTS');
  assertRate(rate);
  return Math.round(amountCents * rate);
}

function calculateTaxBreakdown(amountCents, taxes = []) {
  const lines = taxes.map((tax) => ({
    code: tax.code,
    name: tax.name,
    rate: tax.rate,
    amountCents: calculateTax(amountCents, tax.rate),
    recoverable: tax.recoverable !== false,
  }));
  const taxTotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);
  return { subtotalCents: amountCents, taxes: lines, taxTotalCents, totalCents: amountCents + taxTotalCents };
}

module.exports = { calculateTax, calculateTaxBreakdown };
