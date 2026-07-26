'use strict';

const { publishListing, activateListing } = require('../platform/ecosystem/marketplace');

describe('stage 15 marketplace', () => {
  const listing = { id: 'l1', applicationId: 'a1', partnerId: 'p1', type: 'application', license: 'commercial', pricing: { currency: 'CAD', amount: 10 }, compatibility: '>=1', version: '1.0.0', history: [], certified: true };

  test('refuses uncertified listings', () => {
    expect(() => publishListing({ ...listing, certified: false })).toThrow('certified application');
  });

  test('requires explicit organisation consent before activation', () => {
    const published = publishListing(listing);
    expect(() => activateListing(published, { organisationId: 'org-a', explicit: false, approvedBy: 'u1' })).toThrow('explicit organisation consent');
  });
});
