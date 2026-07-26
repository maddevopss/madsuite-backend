const KINDS = new Set(['fact', 'calculation', 'hypothesis', 'suggestion']);

function createRecommendation(input) {
  if (!input || !input.useCaseId || !input.recommendation) throw new Error('ai.recommendation.identity_required');
  if (!Array.isArray(input.reasons) || input.reasons.length === 0) throw new Error('ai.recommendation.reasons_required');
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) throw new Error('ai.recommendation.evidence_required');
  if (input.evidence.some((item) => !item.sourceId || !KINDS.has(item.kind))) throw new Error('ai.recommendation.evidence_invalid');
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new Error('ai.recommendation.confidence_invalid');
  if (!input.expiresAt || new Date(input.expiresAt).getTime() <= Date.now()) throw new Error('ai.recommendation.expiry_required');
  return Object.freeze({ contract: 'explainable-recommendation@1', ...input, authority: 'advisory', executable: false });
}

module.exports = { createRecommendation };
