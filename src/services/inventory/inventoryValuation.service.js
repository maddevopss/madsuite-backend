'use strict';

function weightedAverageCost(layers = []) {
  const valid = layers.filter((layer) => Number(layer.quantity) > 0);
  const quantity = valid.reduce((sum, layer) => sum + Number(layer.quantity), 0);
  const valueCents = valid.reduce(
    (sum, layer) => sum + Math.round(Number(layer.quantity) * Number(layer.unitCostCents || 0)),
    0,
  );
  return {
    quantity,
    valueCents,
    averageUnitCostCents: quantity > 0 ? Math.round(valueCents / quantity) : 0,
  };
}

function valueStock(items = []) {
  return items.reduce((summary, item) => {
    const quantity = Number(item.quantity || 0);
    const unitCostCents = Number(item.unitCostCents || 0);
    const valueCents = Math.round(quantity * unitCostCents);
    summary.lines.push({ ...item, quantity, unitCostCents, valueCents });
    summary.totalValueCents += valueCents;
    return summary;
  }, { lines: [], totalValueCents: 0 });
}

module.exports = { weightedAverageCost, valueStock };
