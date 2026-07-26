'use strict';

function defineDisasterRecoveryPlan(input) {
  const required = ['scenario', 'owner', 'rtoMinutes', 'rpoMinutes', 'communicationChannel', 'steps'];
  for (const field of required) if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`dr_${field}_required`);
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error('dr_steps_required');
  if (input.rtoMinutes < 0 || input.rpoMinutes < 0) throw new Error('dr_invalid_objective');
  return Object.freeze({ ...input, version: 1 });
}

function assessExercise(plan, exercise) {
  const rtoMet = exercise.recoveryMinutes <= plan.rtoMinutes;
  const rpoMet = exercise.dataLossMinutes <= plan.rpoMinutes;
  return Object.freeze({ passed: rtoMet && rpoMet && exercise.communicationCompleted === true, rtoMet, rpoMet, gaps: exercise.gaps || [] });
}

module.exports = { defineDisasterRecoveryPlan, assessExercise };
