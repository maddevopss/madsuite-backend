'use strict';

function buildInventoryReport({ items = [], movements = [], reservations = [], reorderSuggestions = [] } = {}) {
  const byItem = new Map();
  for (const item of items) byItem.set(String(item.id), { ...item, onHand: 0, reserved: 0, available: 0, valueCents: 0 });
  for (const movement of movements) {
    const row = byItem.get(String(movement.itemId));
    if (!row) continue;
    row.onHand += Number(movement.quantity || 0);
    row.valueCents += Math.round(Number(movement.quantity || 0) * Number(movement.unitCostCents || 0));
  }
  for (const reservation of reservations) {
    const row = byItem.get(String(reservation.itemId));
    if (row) row.reserved += Number(reservation.quantity || 0);
  }
  const lines = [...byItem.values()].map((row) => ({ ...row, available: row.onHand - row.reserved }));
  return {
    lines,
    totalUnits: lines.reduce((sum, row) => sum + row.onHand, 0),
    totalValueCents: lines.reduce((sum, row) => sum + row.valueCents, 0),
    reorderSuggestions,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = { buildInventoryReport };
