'use strict';

function normalizeProduct(input = {}) {
  const sku = String(input.sku || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!sku || !name) throw new Error('SKU et nom requis');
  return {
    sku,
    name,
    description: input.description ? String(input.description).trim() : null,
    unit: String(input.unit || 'unit').trim().toLowerCase(),
    barcode: input.barcode ? String(input.barcode).trim() : null,
    active: input.active !== false,
  };
}

function assertUniqueSku(products, candidate) {
  if (products.some((p) => p.sku === candidate.sku)) throw new Error('SKU déjà utilisé');
  return candidate;
}

module.exports = { normalizeProduct, assertUniqueSku };
