function assertSameOrganisation(context, subject) {
  if (!context?.organisationId || !subject?.organisationId) throw new Error('tenant.missing');
  if (String(context.organisationId) !== String(subject.organisationId)) throw new Error('tenant.cross_reference_forbidden');
  return true;
}

describe('stage7 cross-tenant scenarios', () => {
  test('refuses cross-tenant resources, jobs, events and sessions', () => {
    for (const type of ['resource', 'job', 'event', 'session']) {
      expect(() => assertSameOrganisation({ organisationId: 'a' }, { organisationId: 'b', type })).toThrow('tenant.cross_reference_forbidden');
    }
  });
  test('accepts same-tenant operations', () => expect(assertSameOrganisation({ organisationId: 'a' }, { organisationId: 'a' })).toBe(true));
});

module.exports = { assertSameOrganisation };
