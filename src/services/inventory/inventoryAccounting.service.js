'use strict';

function buildInventoryEntry({ movement, accounts = {} } = {}) {
  if (!movement) throw new Error('Mouvement requis.');
  const quantity = Math.abs(Number(movement.quantity || 0));
  const unitCostCents = Number(movement.unitCostCents || 0);
  const amountCents = Math.round(quantity * unitCostCents);
  if (amountCents <= 0) throw new Error('Une valeur positive est requise pour comptabiliser le mouvement.');

  const isInbound = Number(movement.quantity) > 0;
  const debitAccountId = isInbound ? accounts.inventoryAssetAccountId : accounts.costOfGoodsSoldAccountId;
  const creditAccountId = isInbound ? accounts.payablesOrClearingAccountId : accounts.inventoryAssetAccountId;
  if (!debitAccountId || !creditAccountId) throw new Error('Comptes comptables incomplets.');

  return {
    description: `Mouvement de stock ${movement.id || movement.referenceId || ''}`.trim(),
    sourceType: 'inventory_movement',
    sourceId: String(movement.id || movement.referenceId),
    idempotencyKey: `inventory:${movement.id || movement.referenceId}`,
    lines: [
      { accountId: debitAccountId, debitCents: amountCents, creditCents: 0 },
      { accountId: creditAccountId, debitCents: 0, creditCents: amountCents },
    ],
  };
}

module.exports = { buildInventoryEntry };
