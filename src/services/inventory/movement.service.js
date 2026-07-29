'use strict';

const SIGNS = { receipt: 1, transfer_in: 1, adjustment_in: 1, issue: -1, transfer_out: -1, adjustment_out: -1 };

function normalizeMovement(input = {}) {
  const quantity = Number(input.quantity);
  if (!SIGNS[input.type] || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Mouvement invalide');
  return { ...input, signedQuantity: quantity * SIGNS[input.type], occurredAt: input.occurredAt || new Date().toISOString() };
}

function computeOnHand(movements = []) {
  return movements.reduce((total, movement) => total + Number(movement.signedQuantity || 0), 0);
}

module.exports = { normalizeMovement, computeOnHand };
