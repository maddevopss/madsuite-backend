const { registerPolicy } = require('./transaction-engine.service');

const REQUISITION_CREATE_POLICY = 'procurement.requisition.create@1';
const REQUISITION_DECIDE_POLICY = 'procurement.requisition.decide@1';
const ORDER_TRANSITION_POLICY = 'procurement.order.transition@1';
const RECEIPT_CREATE_POLICY = 'procurement.receipt.create@1';
const INVOICE_MATCH_POLICY = 'procurement.invoice.match@1';

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

function hasEvidence(value) {
  return Array.isArray(value) && value.length > 0;
}

function nonNegativeMoney(...values) {
  return values.every((value) => Number(value || 0) >= 0);
}

function validItems(items) {
  return Array.isArray(items) && items.length > 0 && items.every((item) =>
    String(item.description || '').trim() && Number(item.quantity) > 0 && Number(item.unitPrice || 0) >= 0,
  );
}

function calculateTotals(items = [], taxes = 0) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const taxAmount = Number(taxes || 0);
  return { subtotal, taxes: taxAmount, total: subtotal + taxAmount };
}

registerPolicy('procurement.requisition.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'procurement.idempotency_invalid' };
  if (!input?.requisitionNumber || !input?.title || !String(input.justification || '').trim() || !validItems(input.items)) {
    return { allowed: false, statusCode: 400, code: 'procurement.requisition_incomplete', reason: 'Une demande exige un numéro, un titre, une justification et au moins une ligne valide.' };
  }
  if (!nonNegativeMoney(input.estimatedTotal)) return { allowed: false, statusCode: 400, code: 'procurement.amount_invalid' };
  return { allowed: true, code: 'procurement.requisition_valid' };
});

registerPolicy('procurement.requisition.decide', '1', ({ input, idempotencyKey }) => {
  if (!input?.requisitionId || !['approved', 'rejected', 'cancelled'].includes(input.action) || !validIdempotency(idempotencyKey)) {
    return { allowed: false, statusCode: 400, code: 'procurement.decision_invalid' };
  }
  if (input.action === 'approved' && !hasEvidence(input.evidence)) {
    return { allowed: false, statusCode: 400, code: 'procurement.approval_evidence_required' };
  }
  if (['rejected', 'cancelled'].includes(input.action) && !String(input.reason || '').trim()) {
    return { allowed: false, statusCode: 400, code: 'procurement.reason_required' };
  }
  return { allowed: true };
});

registerPolicy('procurement.order.transition', '1', ({ input, idempotencyKey }) => {
  if (!input?.purchaseOrderId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'procurement.order_transition_invalid' };
  if (['approved', 'sent', 'received', 'closed'].includes(input.action) && !hasEvidence(input.evidence)) {
    return { allowed: false, statusCode: 400, code: 'procurement.order_evidence_required' };
  }
  if (input.action === 'cancelled' && !String(input.reason || '').trim()) return { allowed: false, statusCode: 400, code: 'procurement.reason_required' };
  return { allowed: true };
});

registerPolicy('procurement.receipt.create', '1', ({ input, idempotencyKey }) => {
  if (!input?.purchaseOrderId || !input?.receiptNumber || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'procurement.receipt_invalid' };
  if (!hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: 'procurement.receipt_evidence_required' };
  if (['rejected', 'returned'].includes(input.status) && !String(input.conditionNotes || '').trim()) return { allowed: false, statusCode: 400, code: 'procurement.condition_reason_required' };
  return { allowed: true };
});

registerPolicy('procurement.invoice.match', '1', ({ input, idempotencyKey }) => {
  if (!input?.invoiceId || !validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'procurement.match_invalid' };
  if (!nonNegativeMoney(input.invoiceTotal, input.orderTotal, input.receivedTotal)) return { allowed: false, statusCode: 400, code: 'procurement.amount_invalid' };
  const tolerance = Number(input.tolerance || 0);
  const variance = Math.abs(Number(input.invoiceTotal || 0) - Number(input.orderTotal || 0));
  if (variance > tolerance && !String(input.exceptionReason || '').trim()) {
    return { allowed: false, statusCode: 400, code: 'procurement.exception_reason_required', reason: 'Un écart hors tolérance doit être expliqué.' };
  }
  if (input.status === 'matched' && !hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: 'procurement.match_evidence_required' };
  return { allowed: true, details: { variance, tolerance } };
});

module.exports = {
  REQUISITION_CREATE_POLICY,
  REQUISITION_DECIDE_POLICY,
  ORDER_TRANSITION_POLICY,
  RECEIPT_CREATE_POLICY,
  INVOICE_MATCH_POLICY,
  validIdempotency,
  hasEvidence,
  nonNegativeMoney,
  validItems,
  calculateTotals,
};
