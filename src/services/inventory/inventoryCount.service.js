'use strict';

function compareCount({ expectedQuantity = 0, countedQuantity = 0 } = {}) {
  const expected = Number(expectedQuantity);
  const counted = Number(countedQuantity);
  if (!Number.isFinite(expected) || !Number.isFinite(counted)) throw new Error('Quantités invalides.');
  return {
    expectedQuantity: expected,
    countedQuantity: counted,
    varianceQuantity: counted - expected,
    matches: counted === expected,
  };
}

function summarizeCount(lines = []) {
  return lines.reduce((summary, line) => {
    const compared = compareCount(line);
    summary.lines.push({ ...line, ...compared });
    summary.totalVarianceQuantity += compared.varianceQuantity;
    if (!compared.matches) summary.exceptions += 1;
    return summary;
  }, { lines: [], exceptions: 0, totalVarianceQuantity: 0 });
}

module.exports = { compareCount, summarizeCount };
