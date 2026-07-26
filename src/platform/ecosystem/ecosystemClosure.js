'use strict';

const REQUIRED_PROOFS = [
  'partnerVerified',
  'applicationCertified',
  'sandboxValidated',
  'federatedIdentityIsolated',
  'publicEventsVersioned',
  'marketplaceConsentVerified',
  'revocationTested',
  'interoperabilityTested',
  'loadTested',
  'residualRisksDocumented'
];

function evaluateEcosystemClosure(proofs) {
  const missing = REQUIRED_PROOFS.filter((proof) => proofs?.[proof] !== true);
  return Object.freeze({
    stage: 15,
    closed: missing.length === 0,
    missing,
    authorityTransferredToPartner: false
  });
}

module.exports = { REQUIRED_PROOFS, evaluateEcosystemClosure };
