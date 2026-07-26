const { buildStage7Fixtures } = require('./fixtures/stage7InstitutionalFixtures');

describe('stage7 institutional fixtures', () => {
  test('are reproducible, multi-tenant and synthetic', () => {
    const first = buildStage7Fixtures();
    const second = buildStage7Fixtures();
    expect(first).toEqual(second);
    expect(new Set(first.organisations.map(item => item.id)).size).toBeGreaterThan(1);
    expect(first.users.every(user => first.organisations.some(org => org.id === user.organisationId))).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/password|token|secret/i);
  });
});
