'use strict';

function validateSupplierCommand(command = {}) {
  const errors = [];
  if (command.supplierId !== undefined && !Number(command.supplierId)) errors.push('supplier_id_invalid');
  if (command.amountCents !== undefined && (!Number.isInteger(Number(command.amountCents)) || Number(command.amountCents) <= 0)) errors.push('amount_invalid');
  if (command.billDate && Number.isNaN(Date.parse(command.billDate))) errors.push('bill_date_invalid');
  return { valid: errors.length === 0, errors };
}

function buildSupplierDashboard({ suppliers = [], bills = [], payments = [], performance = [] }) {
  const outstandingCents = bills.reduce((sum, bill) => sum + Number(bill.outstandingCents || 0), 0);
  const overdueBills = bills.filter((bill) => bill.overdue);
  const attentionSuppliers = performance.filter((row) => row.status === 'attention');
  return {
    activeSuppliers: suppliers.filter((supplier) => supplier.isActive !== false).length,
    outstandingCents,
    overdueCents: overdueBills.reduce((sum, bill) => sum + Number(bill.outstandingCents || 0), 0),
    paymentsPending: payments.filter((payment) => payment.status === 'pending').length,
    alerts: [...overdueBills.map((bill) => ({ type: 'overdue_bill', id: bill.id })), ...attentionSuppliers.map((row) => ({ type: 'supplier_attention', id: row.supplierId }))],
  };
}

module.exports = { validateSupplierCommand, buildSupplierDashboard };