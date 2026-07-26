function listResponse(items, meta = {}) {
  return {
    items: Array.isArray(items) ? items : [],
    meta: {
      count: Array.isArray(items) ? items.length : 0,
      ...meta,
    },
  };
}

function resourceResponse(resource, meta = {}) {
  return {
    resource: resource || null,
    meta,
  };
}

module.exports = { listResponse, resourceResponse };
