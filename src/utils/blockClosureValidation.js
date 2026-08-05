class BlockClosureError extends Error {
  constructor(resourceId, resourceType, currentStatus, finalStates = []) {
    super(`block_closure.resource_final`);
    this.name = 'BlockClosureError';
    this.statusCode = 409;
    this.code = 'block_closure.resource_final';
    this.details = {
      resourceId,
      resourceType,
      currentStatus,
      finalStates,
      reason: `Cannot modify ${resourceType} in state '${currentStatus}' — resource is closed/archived/cancelled/completed`,
    };
  }
}

const DEFAULT_FINAL_STATES = ['closed', 'archived', 'cancelled', 'completed'];

function checkBlockClosure(resource, { finalStates = DEFAULT_FINAL_STATES, statusField = 'status' } = {}) {
  if (!resource) return null;

  const currentStatus = resource[statusField];
  if (finalStates.includes(currentStatus)) {
    throw new BlockClosureError(
      resource.id,
      resource.resourceType || 'resource',
      currentStatus,
      finalStates,
    );
  }

  return resource;
}

module.exports = {
  BlockClosureError,
  checkBlockClosure,
  DEFAULT_FINAL_STATES,
};
