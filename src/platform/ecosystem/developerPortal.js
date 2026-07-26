'use strict';

function issueDeveloperCredential(request) {
  const required = ['partnerId', 'applicationId', 'environment', 'scopes', 'expiresAt', 'approvedBy'];
  for (const field of required) if (!request?.[field] || (field === 'scopes' && request.scopes.length === 0)) throw new Error(`${field} is required`);
  if (request.environment === 'production' && request.sandboxValidated !== true) throw new Error('sandbox validation is required');
  return Object.freeze({ ...request, status: 'active', revocable: true });
}

function publishContract(contract) {
  if (!contract?.name || !contract?.version || !contract?.schema || !contract?.compatibilityPolicy) throw new Error('versioned contract is incomplete');
  return Object.freeze({ ...contract, published: true });
}

module.exports = { issueDeveloperCredential, publishContract };
