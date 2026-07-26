function createOperationalReview(input = {}) {
  if (!['weekly','monthly'].includes(input.cadence) || !input.period || !input.owner) throw new Error('review.required_fields');
  const sections = ['majorIncidents','changes','capacity','serviceLevels','risks'];
  for (const section of sections) if (!Array.isArray(input[section])) throw new Error(`review.${section}_required`);
  return { contract:'operational-review@1', cadence:input.cadence, period:input.period, owner:input.owner, majorIncidents:input.majorIncidents, changes:input.changes, capacity:input.capacity, serviceLevels:input.serviceLevels, risks:input.risks, decisions:[], status:'draft' };
}
function recordDecision(review, decision = {}) {
  if (!decision.text || !decision.owner || !decision.dueAt || !decision.evidenceExpected) throw new Error('review.decision_invalid');
  return { ...review, decisions:[...(review.decisions || []), { ...decision, status:'open' }] };
}
function closeReview(review, evidence = {}) {
  const incomplete = (review.decisions || []).filter(item => item.status !== 'done' && !item.followUpReference);
  if (incomplete.length) throw new Error('review.follow_up_required');
  if (!evidence.approvedBy || !evidence.approvedAt) throw new Error('review.approval_required');
  return { ...review, status:'closed', closureEvidence:evidence };
}
module.exports = { createOperationalReview, recordDecision, closeReview };
