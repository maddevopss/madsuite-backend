function calculateCountVariance(lines = []) {
  return lines.reduce((result, line) => {
    const expected = Number(line.expectedQuantity || 0);
    const counted = Number(line.countedQuantity || 0);
    const unitCost = Number(line.unitCost || 0);
    const varianceQuantity = Number((counted - expected).toFixed(3));
    const varianceValue = Number((varianceQuantity * unitCost).toFixed(2));
    result.lines.push({ ...line, varianceQuantity, varianceValue });
    result.totalVarianceQuantity = Number((result.totalVarianceQuantity + varianceQuantity).toFixed(3));
    result.totalVarianceValue = Number((result.totalVarianceValue + varianceValue).toFixed(2));
    if (varianceQuantity !== 0) result.exceptionCount += 1;
    return result;
  }, { lines: [], totalVarianceQuantity: 0, totalVarianceValue: 0, exceptionCount: 0 });
}

function canPostCount({ status, submittedBy, approvedBy }) {
  return status === 'approved' && Boolean(submittedBy) && Boolean(approvedBy) && Number(submittedBy) !== Number(approvedBy);
}

module.exports = { calculateCountVariance, canPostCount };
