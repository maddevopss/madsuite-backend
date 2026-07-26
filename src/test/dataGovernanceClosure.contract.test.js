'use strict';

const { REQUIRED_PROOFS, closeDataGovernanceStage } = require('../governance/dataGovernanceClosure');

describe('stage 14 closure', () => {
  test('refuses incomplete evidence', () => expect(closeDataGovernanceStage({})).toEqual(expect.objectContaining({ closed: false })));
  test('closes only with every required proof', () => {
    const proofs = Object.fromEntries(REQUIRED_PROOFS.map(proof => [proof, true]));
    expect(closeDataGovernanceStage(proofs)).toEqual(expect.objectContaining({ stage: 14, closed: true, missing: [] }));
  });
});
