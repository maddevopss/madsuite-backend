const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const {
  REQUISITION_CREATE_POLICY,
  REQUISITION_DECIDE_POLICY,
  ORDER_TRANSITION_POLICY,
  RECEIPT_CREATE_POLICY,
  INVOICE_MATCH_POLICY,
  calculateTotals,
  validItems,
} = require('../services/business/procurement-transaction.service');

describe('procurement transactional core', () => {
  test('calcule les totaux de façon reproductible', () => {
    expect(calculateTotals([{ quantity: 2, unitPrice: 10 }, { quantity: 1, unitPrice: 5 }], 3)).toEqual({ subtotal: 25, taxes: 3, total: 28 });
  });

  test('refuse une demande sans ligne valide', async () => {
    const decision = await evaluatePolicy({
      policy: REQUISITION_CREATE_POLICY,
      input: { requisitionNumber: 'REQ-1', title: 'Achat', justification: 'Besoin réel', items: [] },
      idempotencyKey: 'requisition-001',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('procurement.requisition_incomplete');
  });

  test('valide seulement les lignes avec quantité positive et prix non négatif', () => {
    expect(validItems([{ description: 'Pièce', quantity: 1, unitPrice: 4 }])).toBe(true);
    expect(validItems([{ description: 'Pièce', quantity: 0, unitPrice: 4 }])).toBe(false);
    expect(validItems([{ description: 'Pièce', quantity: 1, unitPrice: -1 }])).toBe(false);
  });

  test('refuse une approbation sans preuve', async () => {
    const decision = await evaluatePolicy({
      policy: REQUISITION_DECIDE_POLICY,
      input: { requisitionId: 1, action: 'approved', evidence: [] },
      idempotencyKey: 'approval-001',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('procurement.approval_evidence_required');
  });

  test('refuse une annulation de commande sans raison', async () => {
    const decision = await evaluatePolicy({
      policy: ORDER_TRANSITION_POLICY,
      input: { purchaseOrderId: 1, action: 'cancelled' },
      idempotencyKey: 'order-cancel-001',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('procurement.reason_required');
  });

  test('refuse une réception sans preuve', async () => {
    const decision = await evaluatePolicy({
      policy: RECEIPT_CREATE_POLICY,
      input: { purchaseOrderId: 1, receiptNumber: 'REC-1', evidence: [] },
      idempotencyKey: 'receipt-001',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('procurement.receipt_evidence_required');
  });

  test('refuse un rapprochement hors tolérance sans explication', async () => {
    const decision = await evaluatePolicy({
      policy: INVOICE_MATCH_POLICY,
      input: { invoiceId: 1, invoiceTotal: 120, orderTotal: 100, receivedTotal: 100, tolerance: 5, status: 'exception', evidence: [] },
      idempotencyKey: 'invoice-match-001',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('procurement.exception_reason_required');
  });

  test('refuse de déclarer un rapprochement réussi sans preuve', async () => {
    const decision = await evaluatePolicy({
      policy: INVOICE_MATCH_POLICY,
      input: { invoiceId: 1, invoiceTotal: 100, orderTotal: 100, receivedTotal: 100, tolerance: 0, status: 'matched', evidence: [] },
      idempotencyKey: 'invoice-match-002',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('procurement.match_evidence_required');
  });
});
