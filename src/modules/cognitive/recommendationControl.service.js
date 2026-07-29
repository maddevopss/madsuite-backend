'use strict';

function canRecommend(preferences = {}) {
  return preferences.recommendationsEnabled !== false;
}

module.exports = { canRecommend };
