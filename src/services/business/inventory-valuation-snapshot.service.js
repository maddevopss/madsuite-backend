const crypto = require('crypto');

function summarizeValuation(rows = []) {
  return rows.reduce((summary, row) => {
    const quantity = Number(row.quantity || 0);
    const value = Number(row.inventoryValue || row.inventory_value || 0);
    summary.totalQuantity = Number((summary.totalQuantity + quantity).toFixed(3));
    summary.totalValue = Number((summary.totalValue + value).toFixed(2));
    summary.items.add(String(row.itemId || row.item_id));
    summary.locations.add(String(row.locationId || row.location_id));
    return summary;
  }, { totalQuantity: 0, totalValue: 0, items: new Set(), locations: new Set() });
}

function buildSnapshot(rows = [], input = {}) {
  const summary = summarizeValuation(rows);
  const payload = rows.map((row) => ({ ...row }));
  const sourceHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return {
    asOfDate: input.asOfDate,
    valuationMethod: input.valuationMethod || 'weighted_average',
    currency: input.currency || 'CAD',
    totalQuantity: summary.totalQuantity,
    totalValue: summary.totalValue,
    itemCount: summary.items.size,
    locationCount: summary.locations.size,
    payload,
    sourceHash,
  };
}

module.exports = { summarizeValuation, buildSnapshot };
