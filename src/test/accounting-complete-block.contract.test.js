'use strict';

const { evaluateAccountingClosure } = require('../services/business/accounting-complete-block.service');

describe('accounting complete block closure', () => {
  test('refuses an unbalanced trial balance', () => {
    const result = evaluateAccountingClosure({
      trialBalanceDebits: 100,
      trialBalanceCredits: 90,
      unresolvedEntries: 0,
      unresolvedReconciliations: 0,
      evidence: ['review'],
      statementSnapshotIds: [1, 2, 3],
      approvedBy: 9,
    });
    expect(result.allowed).toBe(false);
    expect(result.failures).toContain('balanced');
  });

  test('refuses unresolved entries or reconciliations', () => {
    const result = evaluateAccountingClosure({
      trialBalanceDebits: 100,
      trialBalanceCredits: 100,
      unresolvedEntries: 1,
      unresolvedReconciliations: 2,
      evidence: ['review'],
      statementSnapshotIds: [1, 2, 3],
      approvedBy: 9,
    });
    expect(result.allowed).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(['entriesResolved', 'reconciliationsResolved']));
  });

  test('allows closure only when all controls pass', () => {
    const result = evaluateAccountingClosure({
      trialBalanceDebits: 2500,
      trialBalanceCredits: 2500,
      unresolvedEntries: 0,
      unresolvedReconciliations: 0,
      evidence: ['reviewed-trial-balance'],
      statementSnapshotIds: [11, 12, 13],
      approvedBy: 9,
    });
    expect(result.allowed).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
