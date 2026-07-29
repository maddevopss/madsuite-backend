'use strict';

function normalizeLocation(input = {}) {
  const code = String(input.code || '').trim().toUpperCase();
  const name = String(input.name || '').trim();
  if (!code || !name) throw new Error('Code et nom requis');
  return { code, name, address: input.address || null, active: input.active !== false };
}

function assertUniqueLocation(locations, candidate) {
  if (locations.some((item) => item.code === candidate.code)) throw new Error('Emplacement déjà utilisé');
  return candidate;
}

module.exports = { normalizeLocation, assertUniqueLocation };
