'use strict';

const { defineRetentionPolicy, planDeletion } = require('../governance/dataRetention');

describe('data retention governance', () => {
  test('requires finite retention', () => expect(() => defineRetentionPolicy({ assetId: 'a', owner: 'o', justification: 'j' })).toThrow(/retentionDays/));
  test('blocks deletion under legal hold', () => {
    const policy = defineRetentionPolicy({ assetId: 'a', owner: 'o', justification: 'j', retentionDays: 365, archiveAfterDays: 90, legalHold: true });
    expect(planDeletion(policy, [])).toEqual(expect.objectContaining({ allowed: false, reason: 'legal_hold' }));
  });
});
