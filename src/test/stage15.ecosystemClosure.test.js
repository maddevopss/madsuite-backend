'use strict';

const { REQUIRED_PROOFS, evaluateEcosystemClosure } = require('../platform/ecosystem/ecosystemClosure');

describe('stage 15 ecosystem closure', () => {
  test('refuses closure when one proof is missing', () => {
    const proofs = Object.fromEntries(REQUIRED_PROOFS.map((proof) => [proof, true]));
    proofs.revocationTested = false;
    const result = evaluateEcosystemClosure(proofs);
    expect(result.closed).toBe(false);
    expect(result.missing).toContain('revocationTested');
  });

  test('never transfers final authority to a partner', () => {
    const proofs = Object.fromEntries(REQUIRED_PROOFS.map((proof) => [proof, true]));
    const result = evaluateEcosystemClosure(proofs);
    expect(result.closed).toBe(true);
    expect(result.authorityTransferredToPartner).toBe(false);
  });
});
