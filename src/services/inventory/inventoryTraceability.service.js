'use strict';

function normalizeTrace(input = {}) {
  const lotNumber = input.lotNumber ? String(input.lotNumber).trim() : null;
  const serialNumber = input.serialNumber ? String(input.serialNumber).trim() : null;
  if (lotNumber && serialNumber) throw new Error('Un mouvement ne peut pas utiliser un lot et un numéro de série simultanément.');
  if (serialNumber && Number(input.quantity) !== 1) throw new Error('Un numéro de série représente exactement une unité.');
  return {
    lotNumber,
    serialNumber,
    expiresOn: input.expiresOn || null,
    quantity: Number(input.quantity || 0),
  };
}

function traceMovements(movements = [], query = {}) {
  return movements.filter((movement) => {
    if (query.lotNumber && movement.lotNumber !== query.lotNumber) return false;
    if (query.serialNumber && movement.serialNumber !== query.serialNumber) return false;
    return true;
  });
}

module.exports = { normalizeTrace, traceMovements };
