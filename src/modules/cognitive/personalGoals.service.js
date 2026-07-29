'use strict';

function normalizeGoal(goal) {
  return {
    id: goal.id,
    title: String(goal.title || '').trim(),
    targetDate: goal.targetDate || null,
    progress: Math.max(0, Math.min(100, Number(goal.progress || 0))),
    active: goal.active !== false,
  };
}

module.exports = { normalizeGoal };
