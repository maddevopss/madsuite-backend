const DEFAULT_ACTIONS = ['read', 'create', 'update', 'approve', 'close'];

const ROLE_LEVELS = {
  user: 10,
  member: 10,
  manager: 30,
  admin: 50,
  owner: 60,
  platform_admin: 100,
  master_admin: 100,
};

function normalizeRole(value) {
  return String(value || 'user').trim().toLowerCase();
}

function reason(code, message) {
  return { code, message };
}

function computeServerCapabilities({ user, resource = null, policy = {} } = {}) {
  const role = normalizeRole(user?.role || user?.type);
  const level = ROLE_LEVELS[role] || 0;
  const ownerId = resource?.owner_user_id || resource?.created_by || null;
  const userId = user?.id || user?.userId || null;
  const isOwner = ownerId !== null && userId !== null && String(ownerId) === String(userId);
  const isClosed = ['closed', 'archived', 'cancelled', 'completed'].includes(String(resource?.status || '').toLowerCase());
  const minimum = {
    read: 10,
    create: 10,
    update: 30,
    approve: 50,
    close: 30,
    ...(policy.minimumRoleLevel || {}),
  };

  return DEFAULT_ACTIONS.reduce((result, action) => {
    let allowed = level >= minimum[action];
    let unavailableReason = null;

    if (action === 'update' && isClosed) {
      allowed = false;
      unavailableReason = reason('resource.final', 'La ressource est dans un état final.');
    } else if (action === 'approve' && isOwner && policy.preventSelfApproval !== false) {
      allowed = false;
      unavailableReason = reason('approval.self_forbidden', 'Une approbation indépendante est requise.');
    } else if (!allowed) {
      unavailableReason = reason('permission.insufficient', 'Le rôle courant ne permet pas cette action.');
    }

    if (policy.disabledActions?.includes(action)) {
      allowed = false;
      unavailableReason = reason('capability.disabled', 'Cette action est désactivée par la politique serveur.');
    }

    result[action] = {
      allowed,
      reason: allowed ? null : unavailableReason,
    };
    return result;
  }, {});
}

function capabilitiesMeta(input) {
  return {
    contract: 'server-capabilities@1',
    capabilities: computeServerCapabilities(input),
  };
}

module.exports = {
  DEFAULT_ACTIONS,
  ROLE_LEVELS,
  normalizeRole,
  computeServerCapabilities,
  capabilitiesMeta,
};
