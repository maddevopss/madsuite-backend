'use strict';

function receivePurchaseOrder(order, receivedLines = []) {
  const movements = receivedLines.map((line) => {
    const ordered = order.lines.find((item) => item.productId === line.productId);
    const quantity = Number(line.quantity);
    if (!ordered || quantity <= 0 || quantity > ordered.quantity) throw new Error('Réception invalide');
    return { productId: line.productId, locationId: order.locationId, type: 'receipt', quantity, unitCostCents: ordered.unitCostCents, reference: order.id };
  });
  return { movements, status: movements.length === order.lines.length ? 'received' : 'partial' };
}

module.exports = { receivePurchaseOrder };
