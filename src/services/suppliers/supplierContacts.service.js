'use strict';

function normalizeContact(input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('Le nom du contact est obligatoire.');
  return {
    name,
    role: input.role ? String(input.role).trim() : null,
    email: input.email ? String(input.email).trim().toLowerCase() : null,
    phone: input.phone ? String(input.phone).trim() : null,
    isPrimary: Boolean(input.isPrimary),
  };
}

function enforceSinglePrimary(contacts, candidateIndex) {
  return contacts.map((contact, index) => ({ ...contact, isPrimary: index === candidateIndex }));
}

module.exports = { normalizeContact, enforceSinglePrimary };