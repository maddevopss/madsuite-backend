'use strict';

function canAccessCognitiveData({ requesterUserId, ownerUserId, requesterOrganisationId, ownerOrganisationId, isAdmin = false }) {
  if (requesterOrganisationId !== ownerOrganisationId) return false;
  return isAdmin || requesterUserId === ownerUserId;
}

module.exports = { canAccessCognitiveData };
