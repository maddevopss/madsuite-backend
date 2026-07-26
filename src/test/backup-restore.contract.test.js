const { validateBackupManifest, restorationEvidence, restorationPassed } = require('../operations/backupManifest');

describe('backup and restore contract', () => {
  const manifest = {
    backupId: 'backup-2026-01-01',
    createdAt: '2026-01-01T00:00:00Z',
    database: 'madsuite',
    checksum: 'sha256:abc',
    storageLocation: 's3://backups/backup.sql.gz',
  };

  test('requires a complete backup manifest', () => {
    expect(validateBackupManifest(manifest).contract).toBe('backup-manifest@1');
    expect(() => validateBackupManifest({ backupId: 'x' })).toThrow('backup.manifest.invalid');
  });

  test('records measurable restoration evidence', () => {
    const evidence = restorationEvidence({
      manifest,
      startedAt: '2026-01-02T00:00:00Z',
      completedAt: '2026-01-02T00:05:00Z',
      restoredDatabase: 'madsuite_restore_test',
      verification: { schemaValid: true, rowCountsChecked: true, applicationSmokePassed: true },
    });
    expect(evidence.durationSeconds).toBe(300);
    expect(restorationPassed(evidence)).toBe(true);
  });
});
