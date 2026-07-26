const { evaluateDependency, releaseGate } = require('../security/supplyChainPolicy');

describe('supply chain policy', () => {
  test('refuse une dépendance sans intégrité', () => {
    expect(evaluateDependency({ name: 'x', version: '1.0.0', resolved: 'url', license: 'MIT' }).findings).toContain('dependency.lock_incomplete');
  });

  test('refuse une licence non approuvée', () => {
    expect(releaseGate([{ name: 'x', version: '1.0.0', resolved: 'url', integrity: 'sha512-x', license: 'UNKNOWN' }]).allowed).toBe(false);
  });
});