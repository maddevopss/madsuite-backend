'use strict';

function createTransfer({ productId, fromLocationId, toLocationId, quantity, reference }) {
  const qty = Number(quantity);
  if (!productId || !fromLocationId || !toLocationId) throw new Error('Produit et emplacements requis');
  if (fromLocationId === toLocationId) throw new Error('Les emplacements doivent être différents');
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantité invalide');
  return {
    reference,
    movements: [
      { productId, locationId: fromLocationId, type: 'transfer_out', quantity: qty },
      { productId, locationId: toLocationId, type: 'transfer_in', quantity: qty },
    ],
  };
}

module.exports = { createTransfer };
