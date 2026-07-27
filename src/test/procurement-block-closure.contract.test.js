const fs = require('fs');
const path = require('path');
const { evaluateThreeWayMatch, canApproveInvoice, canPaySupplierInvoice, canClosePurchaseOrder } = require('../services/business/procurement-completion.service');

const migration = fs.readFileSync(path.join(__dirname, '../../db/migrations/20260727221500_procurement_complete_block.sql'), 'utf8');

describe('procurement complete block contract', () => {
  test('declares the full procurement closure tables', () => {
    for (const table of ['procurement_supplier_qualifications','procurement_quote_requests','procurement_supplier_quotes','procurement_receipt_items','procurement_invoice_matches','procurement_supplier_payments','procurement_supplier_performance']) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
      expect(migration).toContain('organisation_id BIGINT NOT NULL');
    }
  });

  test('three-way match accepts values within tolerance', () => {
    expect(evaluateThreeWayMatch({ purchaseOrderTotal: 1000, receivedTotal: 1000, invoiceTotal: 1002, toleranceAmount: 5 }).matched).toBe(true);
  });

  test('invoice exception requires reason and evidence', () => {
    expect(canApproveInvoice({ matchResult: 'exception' }).allowed).toBe(false);
    expect(canApproveInvoice({ matchResult: 'exception', exceptionReason: 'Transport', approvalEvidence: [{ id: 1 }] }).allowed).toBe(true);
  });

  test('payment cannot exceed remaining supplier balance', () => {
    expect(canPaySupplierInvoice({ invoiceStatus: 'approved', invoiceTotal: 500, priorPayments: 400, paymentAmount: 150, evidence: [{ id: 1 }] }).allowed).toBe(false);
  });

  test('purchase order closes only when fully received and evidenced', () => {
    expect(canClosePurchaseOrder({ status: 'received', orderedQuantity: 10, receivedQuantity: 10, evidence: [{ id: 1 }] }).allowed).toBe(true);
    expect(canClosePurchaseOrder({ status: 'partially_received', orderedQuantity: 10, receivedQuantity: 8, evidence: [{ id: 1 }] }).allowed).toBe(false);
  });
});
