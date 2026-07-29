'use strict';

const SUPPLIER_ACTIONS = new Set(['supplier.qualify','supplier.approve','supplier.review','supplier.suspend','supplier.terminate']);

function evaluateSupplierDecision(input = {}) {
  const { organisationId, supplierId, actorId, action, criteria = [], riskLevel, evidenceIds = [], approvalIds = [], reviewDueAt } = input;
  const reasons = [];
  if (!organisationId) reasons.push('ORGANISATION_REQUIRED');
  if (!supplierId) reasons.push('SUPPLIER_REQUIRED');
  if (!actorId) reasons.push('ACTOR_REQUIRED');
  if (!SUPPLIER_ACTIONS.has(action)) reasons.push('UNKNOWN_SUPPLIER_ACTION');
  if (!Array.isArray(criteria) || criteria.length === 0) reasons.push('CRITERIA_REQUIRED');
  if (!riskLevel) reasons.push('RISK_LEVEL_REQUIRED');
  if (evidenceIds.length === 0) reasons.push('EVIDENCE_REQUIRED');
  if (['supplier.approve','supplier.suspend','supplier.terminate'].includes(action) && approvalIds.length === 0) reasons.push('APPROVAL_REQUIRED');
  if (action === 'supplier.review' && !reviewDueAt) reasons.push('REVIEW_DATE_REQUIRED');
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons), context: Object.freeze({ organisationId, supplierId, actorId, action, riskLevel }) });
}

module.exports = { SUPPLIER_ACTIONS, evaluateSupplierDecision };
