function buildExplainableRecommendation(input = {}) {
  const recommendation = String(input.recommendation || '').trim();
  const rationale = String(input.rationale || '').trim();
  const confidence = Number(input.confidence);
  if (!recommendation || !rationale) throw new Error('recommendation and rationale are required');
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('confidence must be between 0 and 1');
  return {
    recommendation,
    rationale,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    appliedRules: Array.isArray(input.appliedRules) ? input.appliedRules : [],
    confidence,
    limitations: Array.isArray(input.limitations) ? input.limitations : [],
  };
}
module.exports = { buildExplainableRecommendation };
