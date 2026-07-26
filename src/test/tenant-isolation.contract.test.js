const { assertSameOrganisation } = require('../security/tenantIsolation');

describe('tenant isolation', () => {
  test('accepte uniquement les références de la même organisation', () => {
    expect(assertSameOrganisation({ actorOrganisationId: 1, resourceOrganisationId: 1, referencedOrganisationIds: [1, 1] }).isolated).toBe(true);
  });

  test('refuse toute référence étrangère', () => {
    expect(() => assertSameOrganisation({ actorOrganisationId: 1, resourceOrganisationId: 2 })).toThrow(expect.objectContaining({ code: 'tenant.cross_reference_forbidden' }));
  });
});