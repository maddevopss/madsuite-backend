'use strict';

function compareLine({ orderedQuantity, receivedQuantity, billedQuantity, orderedUnitCostCents, billedUnitCostCents }) {
  const quantityVariance = Number(billedQuantity) - Number(receivedQuantity);
  const priceVarianceCents = Number(billedUnitCostCents) - Number(orderedUnitCostCents);
  return {
    quantityVariance,
    priceVarianceCents,
    matched: quantityVariance === 0 && priceVarianceCents === 0 && Number(receivedQuantity) <= Number(orderedQuantity),
  };
}

function summarizeMatch(lines = []) {
  const results = lines.map(compareLine);
  return {
    matched: results.every((result) => result.matched),
    exceptions: results.filter((result) => !result.matched),
    lines: results,
  };
}

module.exports = { compareLine, summarizeMatch };