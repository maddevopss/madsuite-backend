const { computeServerCapabilities, capabilitiesMeta } = require('../utils/serverCapabilities');

describe('server capabilities contract', () => {
  test('allows a member to read and create but not approve', () => {
    const capabilities = computeServerCapabilities({ user: { id: 1, role: 'user' } });
    expect(capabilities.read.allowed).toBe(true);
    expect(capabilities.create.allowed).toBe(true);
    expect(capabilities.approve).toEqual({
      allowed: false,
      reason: expect.objectContaining({ code: 'permission.insufficient' }),
    });
  });

  test('prevents self approval even for an administrator', () => {
    const capabilities = computeServerCapabilities({
      user: { id: 7, role: 'admin' },
      resource: { created_by: 7, status: 'pending' },
    });
    expect(capabilities.approve).toEqual({
      allowed: false,
      reason: expect.objectContaining({ code: 'approval.self_forbidden' }),
    });
  });

  test('prevents updates after a final state', () => {
    const capabilities = computeServerCapabilities({
      user: { id: 2, role: 'manager' },
      resource: { created_by: 8, status: 'closed' },
    });
    expect(capabilities.update.reason.code).toBe('resource.final');
  });

  test('supports explicit server policy overrides', () => {
    const capabilities = computeServerCapabilities({
      user: { id: 2, role: 'admin' },
      policy: { disabledActions: ['close'] },
    });
    expect(capabilities.close.reason.code).toBe('capability.disabled');
  });

  test('returns a versioned metadata contract', () => {
    expect(capabilitiesMeta({ user: { role: 'manager' } })).toEqual({
      contract: 'server-capabilities@1',
      capabilities: expect.objectContaining({ read: expect.any(Object), approve: expect.any(Object) }),
    });
  });
});
