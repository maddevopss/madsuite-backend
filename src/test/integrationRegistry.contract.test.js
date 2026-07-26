'use strict';

const { buildIntegrationRegistry, validateIntegrationDefinition } = require('../integrations/integrationRegistry');

const base = {
  id: 'calendar-reference',
  provider: 'reference',
  purpose: 'Synchroniser des rendez-vous autorisés',
  owner: 'operations',
  type: 'partner',
  state: 'approved',
  version: '1.0.0',
  capabilities: ['calendar.read'],
  approvedAt: '2026-07-26T00:00:00Z'
};

describe('integration registry', () => {
  test('publishes a versioned immutable registry', () => {
    const registry = buildIntegrationRegistry([base]);
    expect(registry.version).toBe('integration-registry@1');
    expect(registry.entries).toHaveLength(1);
  });

  test('rejects implicit activation and duplicate identifiers', () => {
    expect(() => validateIntegrationDefinition({ ...base, state: 'active', approvedAt: null }))
      .toThrow('integration.approval.required');
    expect(() => buildIntegrationRegistry([base, base])).toThrow('integration.id.duplicate');
  });
});
