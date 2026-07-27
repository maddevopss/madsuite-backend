function authorizeRecommendationExecution(input = {}) {
  const allowed = new Set(['accepted','rejected','deferred','modified']);
  if (!allowed.has(input.decision)) throw new Error('invalid decision');
  const executionAuthorized = input.decision === 'accepted' || input.decision === 'modified';
  if (input.decision === 'modified' && (!input.modifiedAction || typeof input.modifiedAction !== 'object')) {
    throw new Error('modifiedAction is required for modified decisions');
  }
  return {
    decision: input.decision,
    decisionReason: input.decisionReason || null,
    modifiedAction: input.decision === 'modified' ? input.modifiedAction : null,
    executionAuthorized,
  };
}
module.exports = { authorizeRecommendationExecution };
