'use strict';

const ALLOWED_TYPES = new Set(['internal', 'partner', 'community']);
const ALLOWED_STATES = new Set(['proposed', 'verified', 'certified', 'active', 'suspended', 'revoked']);

function registerExtension(input) {
  const required = ['id', 'publisherId', 'ownerId', 'version', 'type'];
  for (const field of required) {
    if (!input?.[field]) throw new Error(`extension.${field} is required`);
  }
  if (!ALLOWED_TYPES.has(input.type)) throw new Error('extension.type is invalid');
  const state = input.state || 'proposed';
  if (!ALLOWED_STATES.has(state)) throw new Error('extension.state is invalid');
  if ((state === 'active' || state === 'certified') && !input.approvedBy) {
    throw new Error('explicit approval is required');
  }
  return Object.freeze({
    ...input,
    state,
    capabilities: [...new Set(input.capabilities || [])],
    dependencies: [...new Set(input.dependencies || [])],
    registeredAt: input.registeredAt || new Date().toISOString(),
  });
}

module.exports = { ALLOWED_TYPES, ALLOWED_STATES, registerExtension };
