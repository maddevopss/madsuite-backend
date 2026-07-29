'use strict';

const INCOMPATIBLE_ACTIONS = Object.freeze([
  ['recommendation:create', 'approval:create'],
  ['decision:decide', 'verification:create'],
  ['execution:perform', 'verification:create'],
  ['execution:perform', 'audit:read'],
]);

function normalizeAssignments(assignments = []) {
  return assignments
    .filter(Boolean)
    .map(({ userId, capability }) => ({ userId: String(userId), capability }));
}

function findDutyConflicts(assignments = [], incompatibleActions = INCOMPATIBLE_ACTIONS) {
  const normalized = normalizeAssignments(assignments);
  const byUser = new Map();

  for (const assignment of normalized) {
    if (!byUser.has(assignment.userId)) byUser.set(assignment.userId, new Set());
    byUser.get(assignment.userId).add(assignment.capability);
  }

  const conflicts = [];
  for (const [userId, capabilities] of byUser.entries()) {
    for (const [left, right] of incompatibleActions) {
      if (capabilities.has(left) && capabilities.has(right)) {
        conflicts.push({ userId, capabilities: [left, right] });
      }
    }
  }
  return conflicts;
}

function validateSeparationOfDuties(assignments, options = {}) {
  const conflicts = findDutyConflicts(assignments, options.incompatibleActions);
  return {
    valid: conflicts.length === 0,
    conflicts,
    reason: conflicts.length ? 'separation_of_duties_conflict' : null,
  };
}

module.exports = {
  INCOMPATIBLE_ACTIONS,
  findDutyConflicts,
  validateSeparationOfDuties,
};
