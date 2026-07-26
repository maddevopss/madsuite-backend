const { validateAuthorizationMatrix, uncoveredRoutes } = require('../security/authorizationMatrix');

describe('authorization matrix', () => {
  test('refuse une action sensible sans rôle autorisé', () => {
    const result = validateAuthorizationMatrix([{ method: 'POST', path: '/approve', actions: ['approve'], roles: { user: ['read'] } }]);
    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe('authorization.action_unassigned');
  });

  test('détecte une route non couverte', () => {
    expect(uncoveredRoutes([{ method: 'GET', path: '/a' }], [])).toHaveLength(1);
  });
});