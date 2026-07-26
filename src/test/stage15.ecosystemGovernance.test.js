'use strict';

const { recordGovernanceDecision, canAppeal } = require('../platform/ecosystem/ecosystemGovernance');

describe('stage 15 ecosystem governance', () => {
  test('requires attributed evidence and conflict declaration', () => {
    expect(() => recordGovernanceDecision({ subjectType: 'partner', subjectId: 'p1', action: 'suspend', reason: 'risk', decidedBy: 'mad', evidence: ['incident'], appealWindowEndsAt: '2099-01-01' })).toThrow('conflict-of-interest');
  });

  test('keeps sanctions appealable within the declared window', () => {
    const decision = recordGovernanceDecision({ subjectType: 'application', subjectId: 'a1', action: 'revoke', reason: 'non-compliance', decidedBy: 'mad', evidence: ['audit'], appealWindowEndsAt: '2099-01-01', conflictDeclared: true });
    expect(canAppeal(decision, new Date('2026-07-26'))).toBe(true);
  });
});
