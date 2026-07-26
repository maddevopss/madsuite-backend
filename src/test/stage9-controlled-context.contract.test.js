const { buildControlledContext } = require('../ai/controlledInstitutionalContext');

describe('stage 9B controlled context', () => {
  test('minimizes allowed fields and keeps provenance', () => {
    const context = buildControlledContext({ organisationId: 1, userOrganisationId: 1, validUntil: new Date(Date.now() + 60000).toISOString(), allowedFields: ['id', 'status', 'secret'], records: [{ id: 7, status: 'open', secret: 'no', organisation_id: 1 }], sources: [{ id: 'risk:7', type: 'risk', capturedAt: '2026-07-26T00:00:00Z' }] });
    expect(context.records[0]).toEqual({ id: 7, status: 'open' });
    expect(context.provenance).toHaveLength(1);
  });
  test('refuses cross-tenant data', () => {
    expect(() => buildControlledContext({ organisationId: 1, userOrganisationId: 1, validUntil: new Date(Date.now() + 60000).toISOString(), records: [{ organisation_id: 2 }] })).toThrow('ai.context.cross_tenant_reference');
  });
});
