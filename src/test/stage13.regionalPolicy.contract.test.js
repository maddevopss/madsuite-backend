'use strict';
const { defineRegionalPolicy, authorizeRegionalActivation } = require('../resilience/regionalPolicy');
describe('stage 13G regional resilience', () => {
  test('blocks regions outside residency', () => {
    expect(() => defineRegionalPolicy({ organisationId: 'org-1', primaryRegion: 'ca-east', allowedRegions: ['ca-east','eu-west'], dataResidency: ['ca-east'], replicationMode: 'async', routingMode: 'active-passive' })).toThrow('regional_residency_violation');
  });
  test('requires complete activation evidence', () => {
    const policy = defineRegionalPolicy({ organisationId: 'org-1', primaryRegion: 'ca-east', allowedRegions: ['ca-east'], dataResidency: ['ca-east'], replicationMode: 'async', routingMode: 'active-passive' });
    expect(() => authorizeRegionalActivation(policy, { replicationVerified: true, restoreVerified: false, routingVerified: true, approvedBy: 'ops' })).toThrow('regional_activation_not_proven');
  });
});
