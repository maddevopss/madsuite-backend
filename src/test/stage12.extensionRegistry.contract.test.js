'use strict';

const { registerExtension } = require('../platform/extensions/extensionRegistry');

describe('stage 12A extension registry', () => {
  test('refuses implicit activation', () => {
    expect(() => registerExtension({ id: 'ext.demo', publisherId: 'pub', ownerId: 'owner', version: '1.0.0', type: 'partner', state: 'active' })).toThrow('explicit approval');
  });

  test('registers an approved extension', () => {
    const extension = registerExtension({ id: 'ext.demo', publisherId: 'pub', ownerId: 'owner', version: '1.0.0', type: 'partner', state: 'active', approvedBy: 'human-1', capabilities: ['clients.read', 'clients.read'] });
    expect(extension.capabilities).toEqual(['clients.read']);
  });
});
