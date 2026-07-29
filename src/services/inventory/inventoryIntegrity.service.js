'use strict';

function inspectInventoryState({ movements = [], reservations = [], counts = [] } = {}) {
  const findings = [];
  for (const movement of movements) {
    if (!movement.organisationId || !movement.itemId || !movement.locationId) {
      findings.push({ code: 'MOVEMENT_SCOPE_INVALID', movementId: movement.id });
    }
    if (!Number(movement.quantity)) findings.push({ code: 'ZERO_QUANTITY_MOVEMENT', movementId: movement.id });
  }
  for (const reservation of reservations) {
    if (Number(reservation.quantity || 0) < 0) findings.push({ code: 'NEGATIVE_RESERVATION', reservationId: reservation.id });
  }
  for (const count of counts) {
    if (count.status === 'posted' && !count.approvedBy) findings.push({ code: 'UNAPPROVED_COUNT_POSTED', countId: count.id });
  }
  return { healthy: findings.length === 0, findings };
}

function buildInventoryAuditEvent({ action, actorId, organisationId, entityType, entityId, details = {} }) {
  if (!action || !actorId || !organisationId) throw new Error('Événement d’audit incomplet.');
  return { action, actorId, organisationId, entityType, entityId, details, occurredAt: new Date().toISOString() };
}

module.exports = { inspectInventoryState, buildInventoryAuditEvent };
