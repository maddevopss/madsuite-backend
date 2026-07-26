function validateHumanConfirmation({ recommendationId, actor, confirmed, decisionReason, policyAllowed }) {
  if (!recommendationId) throw new Error('ai.execution.recommendation_required');
  if (!actor?.id) throw new Error('ai.execution.human_actor_required');
  if (confirmed !== true) throw new Error('ai.execution.explicit_confirmation_required');
  if (!decisionReason || !String(decisionReason).trim()) throw new Error('ai.execution.reason_required');
  if (policyAllowed !== true) throw new Error('ai.execution.policy_denied');
  return Object.freeze({ contract: 'human-confirmed-execution@1', recommendationId, humanDecisionMakerId: actor.id, decisionReason, confirmedAt: new Date().toISOString() });
}

async function executeConfirmedAction(input, executor) {
  const confirmation = validateHumanConfirmation(input);
  const result = await executor({ ...input, confirmation });
  return { confirmation, result };
}

module.exports = { validateHumanConfirmation, executeConfirmedAction };
