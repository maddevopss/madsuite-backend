'use strict';

function calculateBill(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) throw new Error('Une facture fournisseur doit contenir au moins une ligne.');
  const normalized = lines.map((line) => {
    const quantity = Number(line.quantity ?? 1);
    const unitCostCents = Number(line.unitCostCents ?? 0);
    const taxCents = Number(line.taxCents ?? 0);
    if (quantity <= 0 || !Number.isInteger(unitCostCents) || unitCostCents < 0 || !Number.isInteger(taxCents) || taxCents < 0) {
      throw new Error('Ligne de facture fournisseur invalide.');
    }
    return { ...line, quantity, unitCostCents, taxCents, subtotalCents: Math.round(quantity * unitCostCents) };
  });
  const subtotalCents = normalized.reduce((sum, line) => sum + line.subtotalCents, 0);
  const taxTotalCents = normalized.reduce((sum, line) => sum + line.taxCents, 0);
  return { lines: normalized, subtotalCents, taxTotalCents, totalCents: subtotalCents + taxTotalCents };
}

module.exports = { calculateBill };