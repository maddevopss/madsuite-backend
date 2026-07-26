'use strict';

const { authorizeExtensionAccess } = require('../platform/extensions/extensionPermissions');

describe('stage 12B extension permissions', () => {
  test('denies missing grants', () => {
    expect(authorizeExtensionAccess({ capability: 'clients.read' })).toEqual({ allowed: false, reason: 'denied_by_default' });
  });

  test('enforces organisation and capability scope', () => {
    const grant = { id: 'g1', organisationId: 'org-a', environment: 'production', capabilities: ['clients.read'] };
    expect(authorizeExtensionAccess({ grant, organisationId: 'org-b', environment: 'production', capability: 'clients.read' }).allowed).toBe(false);
    expect(authorizeExtensionAccess({ grant, organisationId: 'org-a', environment: 'production', capability: 'clients.read' }).allowed).toBe(true);
  });
});
