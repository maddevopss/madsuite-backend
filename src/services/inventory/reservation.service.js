'use strict';

function availableQuantity({ onHand = 0, reserved = 0 } = {}) {
  return Math.max(0, Number(onHand) - Number(reserved));
}

function reserveStock(state, requested) {
  const quantity = Number(requested);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantité invalide');
  if (availableQuantity(state) < quantity) throw new Error('Stock insuffisant');
  return { ...state, reserved: Number(state.reserved || 0) + quantity };
}

module.exports = { availableQuantity, reserveStock };
