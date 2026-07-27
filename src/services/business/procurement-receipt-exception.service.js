function summarizeReceiptException({ ordered = 0, received = 0, accepted = 0, unitPrice = 0 }) {
  const orderedQty = Number(ordered);
  const receivedQty = Number(received);
  const acceptedQty = Number(accepted);
  const rejectedQty = Math.max(receivedQty - acceptedQty, 0);
  const shortageQty = Math.max(orderedQty - receivedQty, 0);
  const estimatedValue = Number(((rejectedQty + shortageQty) * Number(unitPrice)).toFixed(2));
  return { orderedQty, receivedQty, acceptedQty, rejectedQty, shortageQty, estimatedValue, hasException: rejectedQty > 0 || shortageQty > 0 };
}
module.exports = { summarizeReceiptException };