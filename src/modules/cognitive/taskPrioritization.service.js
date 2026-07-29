'use strict';

function scoreTask(task) {
  const urgency = Number(task.urgency || 0);
  const importance = Number(task.importance || 0);
  const effortPenalty = Number(task.effort || 0) * 0.25;
  return { ...task, suggestedScore: urgency + importance - effortPenalty };
}

module.exports = { scoreTask };
