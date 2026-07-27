const crypto = require('crypto');
function money(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function buildPaymentBatch(payments = []) {
  if (!Array.isArray(payments) || payments.length === 0) throw Object.assign(new Error('Au moins un paiement est requis.'), { statusCode: 400 });
  const normalized = payments.map((payment) => {
    const amount = money(payment.amount);
    if (!payment.employeeId || amount <= 0) throw Object.assign(new Error('Un paiement de dépôt direct est invalide.'), { statusCode: 400 });
    return { employeeId: payment.employeeId, amount };
  });
  const payload = JSON.stringify(normalized);
  return { payments: normalized, paymentCount: normalized.length, totalAmount: money(normalized.reduce((sum, payment) => sum + payment.amount, 0)), fileHash: crypto.createHash('sha256').update(payload).digest('hex') };
}
module.exports = { buildPaymentBatch };
