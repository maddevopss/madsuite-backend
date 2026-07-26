'use strict';

const { defineBackupPolicy, verifyBackup } = require('../resilience/backupPolicy');

describe('stage 13D verified backups', () => {
  test('requires encryption', () => {
    expect(() => defineBackupPolicy({ resource: 'db', frequencyMinutes: 60, retentionDays: 30, encrypted: false, restoreTestIntervalDays: 7, accessRole: 'backup-operator' })).toThrow('backup_encryption_required');
  });

  test('requires successful restore evidence', () => {
    const policy = defineBackupPolicy({ resource: 'db', frequencyMinutes: 60, retentionDays: 30, encrypted: true, restoreTestIntervalDays: 7, accessRole: 'backup-operator' });
    expect(verifyBackup(policy, { checksumExpected: 'a', checksumObserved: 'a', restoreCompleted: true, recordsVerified: true, verifiedAt: '2026-07-26T00:00:00Z' }).valid).toBe(true);
  });
});
