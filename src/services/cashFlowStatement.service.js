'use strict';

function buildCashFlowStatement(movements = []) {
  const sections = { operating: 0, investing: 0, financing: 0 };
  const rows = movements.map((movement) => {
    if (!Object.prototype.hasOwnProperty.call(sections, movement.activity)) throw new Error('CASH_FLOW_ACTIVITY_INVALID');
    const netCents = (movement.inflowCents || 0) - (movement.outflowCents || 0);
    sections[movement.activity] += netCents;
    return { ...movement, netCents };
  });
  const netChangeCents = Object.values(sections).reduce((sum, value) => sum + value, 0);
  return { rows, sections, netChangeCents };
}

function reconcileCash(openingCashCents, closingCashCents, statement) {
  const expectedClosingCashCents = openingCashCents + statement.netChangeCents;
  return {
    openingCashCents,
    closingCashCents,
    expectedClosingCashCents,
    differenceCents: closingCashCents - expectedClosingCashCents,
    reconciled: closingCashCents === expectedClosingCashCents,
  };
}

module.exports = { buildCashFlowStatement, reconcileCash };
