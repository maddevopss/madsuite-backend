'use strict';

function straightLineSchedule({ costCents, residualValueCents = 0, usefulLifeMonths, inServiceDate }) {
  if (!Number.isInteger(costCents) || !Number.isInteger(residualValueCents)) throw new Error('ASSET_VALUES_MUST_BE_CENTS');
  if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) throw new Error('ASSET_USEFUL_LIFE_INVALID');
  const depreciableCents = costCents - residualValueCents;
  if (depreciableCents < 0) throw new Error('ASSET_RESIDUAL_EXCEEDS_COST');
  const base = Math.floor(depreciableCents / usefulLifeMonths);
  let remainder = depreciableCents - (base * usefulLifeMonths);
  const start = new Date(inServiceDate);
  return Array.from({ length: usefulLifeMonths }, (_, index) => {
    const amountCents = base + (remainder-- > 0 ? 1 : 0);
    const date = new Date(start.getFullYear(), start.getMonth() + index + 1, 0);
    return { period: index + 1, date: date.toISOString().slice(0, 10), amountCents };
  });
}

module.exports = { straightLineSchedule };
