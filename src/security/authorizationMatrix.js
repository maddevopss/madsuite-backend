const ACTIONS = ['read', 'create', 'update', 'transition', 'approve', 'admin'];

function validateAuthorizationMatrix(entries = []) {
  const errors = [];
  const seen = new Set();
  for (const entry of entries) {
    const key = `${entry.method}:${entry.path}`;
    if (seen.has(key)) errors.push({ code: 'authorization.route_duplicate', key });
    seen.add(key);
    if (!entry.roles || typeof entry.roles !== 'object') errors.push({ code: 'authorization.roles_missing', key });
    for (const action of ACTIONS) {
      if (entry.actions?.includes(action) && !Object.values(entry.roles || {}).some((allowed) => allowed?.includes(action))) {
        errors.push({ code: 'authorization.action_unassigned', key, action });
      }
    }
  }
  return { contract: 'authorization-matrix@1', valid: errors.length === 0, errors };
}

function uncoveredRoutes(routes = [], matrix = []) {
  const covered = new Set(matrix.map((entry) => `${entry.method}:${entry.path}`));
  return routes.filter((route) => !covered.has(`${route.method}:${route.path}`));
}

module.exports = { ACTIONS, validateAuthorizationMatrix, uncoveredRoutes };