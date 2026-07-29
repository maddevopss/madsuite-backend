'use strict';

const ALLOWED_TRANSITIONS = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected'],
  approved: ['posted'],
  rejected: [],
  posted: [],
  cancelled: [],
};

function transitionAdjustment(adjustment, nextStatus, actorId) {
  const current = adjustment.status || 'draft';
  if (!ALLOWED_TRANSITIONS[current]?.includes(nextStatus)) {
    throw new Error(`Transition d’ajustement invalide: ${current} → ${nextStatus}`);
  }
  if (nextStatus === 'approved' && !actorId) throw new Error('Un approbateur est requis.');
  return {
    ...adjustment,
    status: nextStatus,
    approvedBy: nextStatus === 'approved' ? actorId : adjustment.approvedBy || null,
    approvedAt: nextStatus === 'approved' ? new Date().toISOString() : adjustment.approvedAt || null,
  };
}

function buildAdjustmentMovement(adjustment) {
  if (adjustment.status !== 'approved') throw new Error('Seul un ajustement approuvé peut modifier le stock.');
  const quantity = Number(adjustment.varianceQuantity || 0);
  if (!quantity) throw new Error('Un ajustement nul est interdit.');
  return {
    movementType: 'adjustment',
    quantity,
    referenceType: 'inventory_count',
    referenceId: String(adjustment.countId),
    note: adjustment.reason,
  };
}

module.exports = { transitionAdjustment, buildAdjustmentMovement };
