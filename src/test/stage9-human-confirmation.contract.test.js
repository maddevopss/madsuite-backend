const { validateHumanConfirmation } = require('../ai/humanConfirmedExecution');

describe('stage 9D human confirmation', () => {
  test('requires a human and existing policy approval', () => {
    expect(validateHumanConfirmation({ recommendationId: 'r1', actor: { id: 7 }, confirmed: true, decisionReason: 'Vérifié', policyAllowed: true })).toEqual(expect.objectContaining({ humanDecisionMakerId: 7 }));
  });
  test('refuses implicit confirmation', () => {
    expect(() => validateHumanConfirmation({ recommendationId: 'r1', actor: { id: 7 }, confirmed: false, decisionReason: 'non', policyAllowed: true })).toThrow('ai.execution.explicit_confirmation_required');
  });
});
