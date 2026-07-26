'use strict';

const { publishCatalogEntry, authorizeCatalogInstallation } = require('../platform/extensions/extensionCatalog');

describe('stage 12G extension catalog', () => {
  test('publishes required compatibility and certification data', () => {
    const entry = publishCatalogEntry({ id: 'ext.demo', name: 'Demo', version: '1.0.0', publisherId: 'pub', license: 'commercial', compatibility: '>=1.0.0', certificationLevel: 'verified', state: 'active' });
    expect(entry.installable).toBe(true);
  });

  test('requires explicit organisation consent', () => {
    const entry = { installable: true };
    expect(authorizeCatalogInstallation({ entry, consent: { explicit: false }, organisationId: 'org-a' }).allowed).toBe(false);
  });
});
