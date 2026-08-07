function guardSensitiveTransition({ actor, resource, payload = {}, idempotencyKey, replayed = false }) {
  if (String(actor?.id) === String(resource?.created_by) && payload.action === 'approve') {
    const error = new Error('Auto-approbation interdite.');
    error.code = 'transition.self_approval_forbidden';
    throw error;
  }
  if (payload.role || payload.permissions || payload.organisationId) {
    const error = new Error('Champs d’autorité fournis par le client interdits.');
    error.code = 'transition.client_authority_forbidden';
    throw error;
  }
  if (!idempotencyKey || replayed) {
    const error = new Error('Rejeu ou clé d’idempotence invalide.');
    error.code = replayed ? 'transition.replay_detected' : 'transition.idempotency_required';
    throw error;
  }
  return { contract: 'sensitive-transition-guard@1', allowed: true };
}

module.exports = { guardSensitiveTransition };