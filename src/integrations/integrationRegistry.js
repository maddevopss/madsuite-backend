'use strict';

const STATES = new Set(['proposed', 'approved', 'active', 'suspended', 'revoked']);
const TYPES = new Set(['internal', 'partner', 'customer']);

function validateIntegrationDefinition(definition) {
  const required = ['id', 'provider', 'purpose', 'owner', 'type', 'state', 'version', 'capabilities'];
  for (const field of required) {
    if (definition[field] === undefined || definition[field] === null || definition[field] === '') {
      throw new Error(`integration.${field}.required`);
    }
  }
  if (!TYPES.has(definition.type)) throw new Error('integration.type.invalid');
  if (!STATES.has(definition.state)) throw new Error('integration.state.invalid');
  if (!Array.isArray(definition.capabilities) || definition.capabilities.length === 0) {
    throw new Error('integration.capabilities.required');
  }
  if (definition.state === 'active' && definition.approvedAt == null) {
    throw new Error('integration.approval.required');
  }
  return Object.freeze({ ...definition, capabilities: Object.freeze([...definition.capabilities]) });
}

function buildIntegrationRegistry(definitions) {
  const byId = new Map();
  for (const definition of definitions) {
    const validated = validateIntegrationDefinition(definition);
    if (byId.has(validated.id)) throw new Error('integration.id.duplicate');
    byId.set(validated.id, validated);
  }
  return Object.freeze({ version: 'integration-registry@1', entries: Object.freeze([...byId.values()]) });
}

module.exports = { STATES, TYPES, validateIntegrationDefinition, buildIntegrationRegistry };
