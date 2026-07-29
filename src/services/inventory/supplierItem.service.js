'use strict';

function normalizeSupplierItem(input = {}) {
  if (!input.productId || !input.supplierId) throw new Error('Produit et fournisseur requis');
  const unitCostCents = Number(input.unitCostCents);
  if (!Number.isInteger(unitCostCents) || unitCostCents < 0) throw new Error('Coût invalide');
  return {
    productId: input.productId,
    supplierId: input.supplierId,
    supplierSku: input.supplierSku || null,
    unitCostCents,
    minimumOrderQuantity: Number(input.minimumOrderQuantity || 1),
    leadTimeDays: Number(input.leadTimeDays || 0),
    preferred: Boolean(input.preferred),
  };
}

module.exports = { normalizeSupplierItem };
