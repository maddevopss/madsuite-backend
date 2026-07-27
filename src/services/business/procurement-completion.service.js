const hasEvidence = (value) => Array.isArray(value) && value.length > 0;
const asMoney = (value) => Number(value || 0);

function evaluateThreeWayMatch({ purchaseOrderTotal, receivedTotal, invoiceTotal, toleranceAmount = 0 }) {
  const po = asMoney(purchaseOrderTotal);
  const receipt = asMoney(receivedTotal);
  const invoice = asMoney(invoiceTotal);
  const tolerance = Math.max(0, asMoney(toleranceAmount));
  const amountVariance = invoice - po;
  const receiptVariance = invoice - receipt;
  const matched = Math.abs(amountVariance) <= tolerance && Math.abs(receiptVariance) <= tolerance;
  return { matched, amountVariance, receiptVariance, result: matched ? 'matched' : 'exception' };
}

function canApproveInvoice({ matchResult, exceptionReason, approvalEvidence = [] }) {
  if (matchResult === 'matched') return { allowed: true, code: 'procurement.invoice.matched' };
  if (!String(exceptionReason || '').trim()) return { allowed: false, code: 'procurement.exception.reason_required' };
  if (!hasEvidence(approvalEvidence)) return { allowed: false, code: 'procurement.exception.evidence_required' };
  return { allowed: true, code: 'procurement.exception.approved' };
}

function canPaySupplierInvoice({ invoiceStatus, invoiceTotal, priorPayments = 0, paymentAmount, evidence = [] }) {
  if (!['approved', 'paid'].includes(invoiceStatus)) return { allowed: false, code: 'procurement.payment.invoice_not_approved' };
  if (!hasEvidence(evidence)) return { allowed: false, code: 'procurement.payment.evidence_required' };
  const amount = asMoney(paymentAmount);
  const remaining = asMoney(invoiceTotal) - asMoney(priorPayments);
  if (!(amount > 0)) return { allowed: false, code: 'procurement.payment.amount_invalid' };
  if (amount > remaining) return { allowed: false, code: 'procurement.payment.exceeds_balance' };
  return { allowed: true, code: amount === remaining ? 'procurement.payment.closes_invoice' : 'procurement.payment.partial', remainingAfter: remaining - amount };
}

function canClosePurchaseOrder({ status, orderedQuantity, receivedQuantity, openExceptions = 0, evidence = [] }) {
  if (!['received', 'partially_received'].includes(status)) return { allowed: false, code: 'procurement.order.not_received' };
  if (Number(receivedQuantity) < Number(orderedQuantity)) return { allowed: false, code: 'procurement.order.quantity_incomplete' };
  if (Number(openExceptions) > 0) return { allowed: false, code: 'procurement.order.exceptions_open' };
  if (!hasEvidence(evidence)) return { allowed: false, code: 'procurement.order.closure_evidence_required' };
  return { allowed: true, code: 'procurement.order.closable' };
}

module.exports = { hasEvidence, evaluateThreeWayMatch, canApproveInvoice, canPaySupplierInvoice, canClosePurchaseOrder };
