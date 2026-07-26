const ORDER = ['declared', 'contained', 'restored', 'closed'];
function transitionIncident(incident, next, evidence = {}) {
  const current = incident.status || 'declared';
  if (ORDER.indexOf(next) !== ORDER.indexOf(current) + 1) throw new Error('incident.transition_invalid');
  if (next === 'restored' && !evidence.restorationProof) throw new Error('incident.restoration_proof_required');
  if (next === 'closed' && !evidence.provisionalCause) throw new Error('incident.provisional_cause_required');
  return { ...incident, status: next, timeline: [...(incident.timeline || []), { from: current, to: next, at: evidence.at || new Date().toISOString(), actor: evidence.actor || null }], evidence: { ...(incident.evidence || {}), ...evidence } };
}
function createIncident(input = {}) {
  if (!input.serviceId || !input.owner || !input.impact) throw new Error('incident.required_fields');
  if (!['minor','major','critical'].includes(input.severity)) throw new Error('incident.severity_invalid');
  return { contract: 'incident-lifecycle@1', id: input.id, serviceId: input.serviceId, owner: input.owner, impact: input.impact, severity: input.severity, status: 'declared', links: input.links || [], timeline: [] };
}
module.exports = { createIncident, transitionIncident };
