const nonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

function calculateAvailableQuantity({ quantityOnHand = 0, reservedQuantity = 0 }) {
  return Number(quantityOnHand) - Number(reservedQuantity);
}

function validateReservation({ quantity, availableQuantity, evidence = [] }) {
  if (!nonNegative(quantity) || Number(quantity) <= 0) return { allowed: false, code: 'inventory.reservation.quantity_invalid' };
  if (Number(quantity) > Number(availableQuantity)) return { allowed: false, code: 'inventory.reservation.insufficient_available' };
  if (!Array.isArray(evidence) || evidence.length === 0) return { allowed: false, code: 'inventory.reservation.evidence_required' };
  return { allowed: true, code: 'inventory.reservation.valid' };
}

function calculateCountVariance({ expectedQuantity = 0, countedQuantity = 0, unitCost = 0 }) {
  const varianceQuantity = Number(countedQuantity) - Number(expectedQuantity);
  return { varianceQuantity, varianceValue: Number((varianceQuantity * Number(unitCost)).toFixed(2)) };
}

function validateCycleCountApproval({ status, items = [], evidence = [], decisionReason }) {
  if (status !== 'submitted') return { allowed: false, code: 'inventory.count.not_submitted' };
  if (!Array.isArray(items) || items.length === 0) return { allowed: false, code: 'inventory.count.items_required' };
  if (items.some((item) => item.countedQuantity == null || !nonNegative(item.countedQuantity))) return { allowed: false, code: 'inventory.count.incomplete' };
  const hasVariance = items.some((item) => Number(item.countedQuantity) !== Number(item.expectedQuantity));
  if (hasVariance && !String(decisionReason || '').trim()) return { allowed: false, code: 'inventory.count.variance_reason_required' };
  if (!Array.isArray(evidence) || evidence.length === 0) return { allowed: false, code: 'inventory.count.evidence_required' };
  return { allowed: true, code: 'inventory.count.approvable' };
}

function validateLotDisposition({ status, quantity, reason, evidence = [] }) {
  if (!['expired', 'disposed', 'quarantined'].includes(status)) return { allowed: true, code: 'inventory.lot.no_disposition_required' };
  if (!nonNegative(quantity)) return { allowed: false, code: 'inventory.lot.quantity_invalid' };
  if (!String(reason || '').trim()) return { allowed: false, code: 'inventory.lot.reason_required' };
  if (!Array.isArray(evidence) || evidence.length === 0) return { allowed: false, code: 'inventory.lot.evidence_required' };
  return { allowed: true, code: 'inventory.lot.disposition_valid' };
}

function validateInventoryClosure({ unresolvedCounts = 0, negativeBalances = 0, expiredLotsAvailable = 0, evidence = [] }) {
  if (Number(unresolvedCounts) > 0) return { allowed: false, code: 'inventory.closure.counts_unresolved' };
  if (Number(negativeBalances) > 0) return { allowed: false, code: 'inventory.closure.negative_balances' };
  if (Number(expiredLotsAvailable) > 0) return { allowed: false, code: 'inventory.closure.expired_lots_available' };
  if (!Array.isArray(evidence) || evidence.length === 0) return { allowed: false, code: 'inventory.closure.evidence_required' };
  return { allowed: true, code: 'inventory.closure.valid' };
}

module.exports = {
  calculateAvailableQuantity,
  validateReservation,
  calculateCountVariance,
  validateCycleCountApproval,
  validateLotDisposition,
  validateInventoryClosure,
};