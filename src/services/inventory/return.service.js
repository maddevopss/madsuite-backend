'use strict';

function createReturn({ productId, locationId, quantity, direction, reference }) {
  const qty = Number(quantity);
  if (!productId || !locationId || qty <= 0) throw new Error('Retour invalide');
  if (!['customer', 'supplier'].includes(direction)) throw new Error('Direction invalide');
  return {
    productId,
    locationId,
    type: direction === 'customer' ? 'receipt' : 'issue',
    quantity: qty,
    reference,
    reason: 'return',
  };
}

module.exports = { createReturn };
