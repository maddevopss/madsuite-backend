function validateBackupManifest(manifest = {}) {
  const required = ['backupId', 'createdAt', 'database', 'checksum', 'storageLocation'];
  const missing = required.filter((key) => !String(manifest[key] || '').trim());
  if (missing.length) {
    const error = new Error('backup.manifest.invalid');
    error.details = { missing };
    throw error;
  }
  return Object.freeze({
    contract: 'backup-manifest@1',
    backupId: String(manifest.backupId),
    createdAt: new Date(manifest.createdAt).toISOString(),
    database: String(manifest.database),
    checksum: String(manifest.checksum),
    storageLocation: String(manifest.storageLocation),
  });
}

function restorationEvidence({ manifest, startedAt, completedAt, restoredDatabase, verification = {} } = {}) {
  const validManifest = validateBackupManifest(manifest);
  const started = new Date(startedAt);
  const completed = new Date(completedAt);
  if (!restoredDatabase || Number.isNaN(started.getTime()) || Number.isNaN(completed.getTime()) || completed < started) {
    throw new Error('restore.evidence.invalid');
  }
  return Object.freeze({
    contract: 'restore-evidence@1',
    backupId: validManifest.backupId,
    restoredDatabase: String(restoredDatabase),
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    durationSeconds: Math.round((completed - started) / 1000),
    verification: {
      schemaValid: verification.schemaValid === true,
      rowCountsChecked: verification.rowCountsChecked === true,
      applicationSmokePassed: verification.applicationSmokePassed === true,
    },
  });
}

function restorationPassed(evidence) {
  return evidence?.contract === 'restore-evidence@1' && Object.values(evidence.verification).every(Boolean);
}

module.exports = { validateBackupManifest, restorationEvidence, restorationPassed };
