'use strict';

function normalizeSupplier(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Le nom du fournisseur est obligatoire.');
  return {
    supplierCode: input.supplierCode ? String(input.supplierCode).trim().toUpperCase() : null,
    name,
    contactName: input.contactName ? String(input.contactName).trim() : null,
    email: input.email ? String(input.email).trim().toLowerCase() : null,
    phone: input.phone ? String(input.phone).trim() : null,
    taxNumber: input.taxNumber ? String(input.taxNumber).trim() : null,
    currencyCode: String(input.currencyCode || 'CAD').toUpperCase(),
    paymentTermsDays: Number(input.paymentTermsDays ?? 30),
    address: input.address || {},
    notes: input.notes ? String(input.notes).trim() : null,
    isActive: input.isActive !== false,
  };
}

function assertUniqueSupplierCode(existing, candidate) {
  if (!candidate.supplierCode) return;
  const duplicate = existing.some((supplier) => supplier.supplierCode === candidate.supplierCode);
  if (duplicate) throw new Error('Ce code fournisseur est déjà utilisé.');
}

module.exports = { normalizeSupplier, assertUniqueSupplierCode };