function buildWorkResumption(input = {}) {
  const objective = String(input.objective || '').trim();
  const nextAction = String(input.nextAction || '').trim();
  if (!objective || !nextAction) throw new Error('objective and nextAction are required');
  return {
    objective,
    lastCompletedStep: input.lastCompletedStep || null,
    nextAction,
    blockers: Array.isArray(input.blockers) ? input.blockers : [],
    openItems: Array.isArray(input.openItems) ? input.openItems : [],
    contextPayload: input.contextPayload && typeof input.contextPayload === 'object' ? input.contextPayload : {},
  };
}
module.exports = { buildWorkResumption };
