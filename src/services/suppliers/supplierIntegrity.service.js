'use strict';

function validateSupplierOperation(operation) {
  const errors = [];
  if (!operation.organisationId) errors.push('organisation_missing');
  if (!operation.supplierId) errors.push('supplier_missing');
  if (operation.amountCents !== undefined && (!Number.isInteger(Number(operation.amountCents)) || Number(operation.amountCents) < 0)) errors.push('amount_invalid');
  if (operation.status === 'paid' && Number(operation.outstandingCents || 0) !== 0) errors.push('paid_with_balance');
  if (operation.status === 'approved' && !operation.approvedBy) errors.push('approval_missing');
  return { valid: errors.length === 0, errors };
}

function auditEvent(action, entity, actorId, details = {}) {
  return { domain: 'suppliers', action, entityType: entity.type, entityId: entity.id, actorId, details, occurredAt: new Date().toISOString() };
}

module.exports = { validateSupplierOperation, auditEvent };