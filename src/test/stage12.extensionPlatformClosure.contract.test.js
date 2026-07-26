'use strict';

const { registerExtension } = require('../platform/extensions/extensionRegistry');
const { authorizeExtensionAccess } = require('../platform/extensions/extensionPermissions');
const { evaluateSandboxRequest } = require('../platform/extensions/extensionSandboxPolicy');
const { verifyExtensionPackage } = require('../platform/extensions/extensionSignaturePolicy');
const { transitionExtension } = require('../platform/extensions/extensionLifecycle');
const { evaluateCertification } = require('../platform/extensions/extensionCertification');
const { authorizeCatalogInstallation } = require('../platform/extensions/extensionCatalog');

describe('stage 12H institutional closure', () => {
  test('keeps every extension subordinate to MADSuite authority', () => {
    expect(() => registerExtension({ id: 'x', publisherId: 'p', ownerId: 'o', version: '1', type: 'partner', state: 'active' })).toThrow();
    expect(authorizeExtensionAccess({ capability: 'clients.read' }).allowed).toBe(false);
    expect(evaluateSandboxRequest({ resource: 'postgresql.direct', contract: { approved: true } }).allowed).toBe(false);
    expect(verifyExtensionPackage({ packageHash: 'a', signedHash: 'a', publisherKey: { id: 'k', verified: true }, revokedKeyIds: ['k'] }).valid).toBe(false);
    expect(() => transitionExtension({ currentState: 'installed', nextState: 'active', approvedBy: 'human', compatibility: { compatible: false } })).toThrow();
    expect(evaluateCertification({ level: 'verified', evidence: {} }).certified).toBe(false);
    expect(authorizeCatalogInstallation({ entry: { installable: true }, consent: { explicit: false }, organisationId: 'org-a' }).allowed).toBe(false);
  });
});
