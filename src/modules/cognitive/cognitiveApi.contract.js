'use strict';

function validateCognitiveQuery(query = {}) {
  return {
    from: query.from || null,
    to: query.to || null,
    includeRecommendations: query.includeRecommendations !== false,
  };
}

module.exports = { validateCognitiveQuery };
