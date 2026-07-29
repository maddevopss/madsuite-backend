'use strict';

function buildSpatialContext({ module = null, route = null, entityType = null, entityId = null } = {}) {
  return { module, route, entityType, entityId };
}

module.exports = { buildSpatialContext };
