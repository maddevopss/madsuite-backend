'use strict';

const INVENTORY_ACTIONS = new Set(['stock.loss','stock.theft','stock.destroy','stock.return','stock.transfer','stock.adjust']);

function evaluateInventoryMovement(input = {}) {
  const { organisationId, actorId, itemId, action, quantity, justification, evidenceIds = [], approvalIds = [], destinationOrganisationId = organisationId } = input;
  const reasons = [];
  if (!organisationId) reasons.push('ORGANISATION_REQUIRED');
  if (!actorId) reasons.push('ACTOR_REQUIRED');
  if (!itemId) reasons.push('ITEM_REQUIRED');
  if (!INVENTORY_ACTIONS.has(action)) reasons.push('UNKNOWN_INVENTORY_ACTION');
  if (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0) reasons.push('POSITIVE_QUANTITY_REQUIRED');
  if (!justification || !String(justification).trim()) reasons.push('JUSTIFICATION_REQUIRED');
  if (['stock.loss','stock.theft','stock.destroy','stock.adjust'].includes(action) && evidenceIds.length === 0) reasons.push('EVIDENCE_REQUIRED');
  if (['stock.destroy','stock.adjust'].includes(action) && approvalIds.length === 0) reasons.push('APPROVAL_REQUIRED');
  if (destinationOrganisationId !== organisationId) reasons.push('CROSS_ORGANISATION_MOVEMENT_FORBIDDEN');
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons), context: Object.freeze({ organisationId, actorId, itemId, action, quantity: Number(quantity) }) });
}

module.exports = { INVENTORY_ACTIONS, evaluateInventoryMovement };
