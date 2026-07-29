'use strict';

const { canAccessCognitiveData } = require('../modules/cognitive/permissions.service');

describe('cognitive continuity security', () => {
  test('refuses cross-organisation access', () => {
    expect(canAccessCognitiveData({
      requesterUserId: 1,
      ownerUserId: 1,
      requesterOrganisationId: 10,
      ownerOrganisationId: 20,
      isAdmin: true,
    })).toBe(false);
  });
});
