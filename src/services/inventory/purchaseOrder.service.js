'use strict';

function createPurchaseOrder({ supplierId, locationId, lines = [], expectedAt }) {
  if (!supplierId || !locationId || lines.length === 0) throw new Error('Commande fournisseur incomplète');
  const normalized = lines.map((line) => {
    const quantity = Number(line.quantity);
    const unitCostCents = Number(line.unitCostCents);
    if (!line.productId || quantity <= 0 || !Number.isInteger(unitCostCents) || unitCostCents < 0) throw new Error('Ligne invalide');
    return { ...line, quantity, unitCostCents, totalCents: Math.round(quantity * unitCostCents) };
  });
  return { supplierId, locationId, expectedAt: expectedAt || null, status: 'draft', lines: normalized, totalCents: normalized.reduce((sum, line) => sum + line.totalCents, 0) };
}

module.exports = { createPurchaseOrder };
