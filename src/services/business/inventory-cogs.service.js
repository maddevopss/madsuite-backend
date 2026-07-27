function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function buildInventoryPosting(input) {
  const quantity = Number(input.quantity || 0);
  const unitCost = Number(input.unitCost || 0);
  if (!(quantity > 0) || unitCost < 0) throw new Error('Quantité ou coût unitaire invalide.');
  const amount = roundMoney(quantity * unitCost);
  const direction = ['receipt', 'return', 'adjustment_gain'].includes(input.postingType) ? 'increase' : 'decrease';
  const lines = direction === 'increase'
    ? [
      { accountId: input.inventoryAccountId, debit: amount, credit: 0 },
      { accountId: input.offsetAccountId, debit: 0, credit: amount },
    ]
    : [
      { accountId: input.offsetAccountId, debit: amount, credit: 0 },
      { accountId: input.inventoryAccountId, debit: 0, credit: amount },
    ];
  return { amount, direction, lines };
}

function isBalanced(lines = []) {
  const debit = roundMoney(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const credit = roundMoney(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));
  return debit === credit;
}

module.exports = { buildInventoryPosting, isBalanced };
