'use strict';

const ACTIONS = new Set(['receive', 'issue', 'transfer', 'reserve', 'release', 'count', 'adjust']);

function validateInventoryCommand(input = {}) {
  if (!ACTIONS.has(input.action)) throw new Error('Action d’inventaire invalide.');
  if (!input.organisationId) throw new Error('Organisation requise.');
  if (!input.itemId) throw new Error('Produit requis.');
  if (!input.locationId && input.action !== 'transfer') throw new Error('Emplacement requis.');
  if (input.action === 'transfer' && (!input.fromLocationId || !input.toLocationId)) {
    throw new Error('Les deux emplacements sont requis pour un transfert.');
  }
  if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) <= 0) {
    throw new Error('La quantité doit être positive.');
  }
  return { ...input, quantity: Number(input.quantity) };
}

function buildInventoryDashboard(report = {}) {
  const lines = report.lines || [];
  return {
    products: lines.length,
    totalUnits: Number(report.totalUnits || 0),
    totalValueCents: Number(report.totalValueCents || 0),
    lowStockCount: (report.reorderSuggestions || []).length,
    negativeStockCount: lines.filter((line) => Number(line.available || 0) < 0).length,
    alerts: [
      ...(report.reorderSuggestions || []).map((line) => ({ type: 'reorder', itemId: line.itemId })),
      ...lines.filter((line) => Number(line.available || 0) < 0).map((line) => ({ type: 'negative_stock', itemId: line.id })),
    ],
  };
}

module.exports = { validateInventoryCommand, buildInventoryDashboard };
