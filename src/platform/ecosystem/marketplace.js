'use strict';

function publishListing(listing) {
  const required = ['id', 'applicationId', 'partnerId', 'type', 'license', 'pricing', 'compatibility', 'version', 'history'];
  for (const field of required) if (listing?.[field] === undefined || listing[field] === null || listing[field] === '') throw new Error(`${field} is required`);
  if (listing.certified !== true) throw new Error('certified application is required');
  return Object.freeze({ ...listing, status: 'published' });
}

function activateListing(listing, consent) {
  if (listing?.status !== 'published') throw new Error('published listing is required');
  if (!consent?.organisationId || consent.explicit !== true || !consent.approvedBy) throw new Error('explicit organisation consent is required');
  return Object.freeze({ listingId: listing.id, organisationId: consent.organisationId, active: true, approvedBy: consent.approvedBy });
}

module.exports = { publishListing, activateListing };
