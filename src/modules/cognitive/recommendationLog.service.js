'use strict';

function createRecommendationLog(entry) {
  return {
    id: entry.id,
    userId: entry.userId,
    organisationId: entry.organisationId,
    recommendation: entry.recommendation,
    outcome: entry.outcome || 'pending',
    createdAt: entry.createdAt || new Date().toISOString(),
  };
}

module.exports = { createRecommendationLog };
