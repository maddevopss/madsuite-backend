'use strict';

function defineBackupPolicy(input) {
  const required = ['resource', 'frequencyMinutes', 'retentionDays', 'encrypted', 'restoreTestIntervalDays', 'accessRole'];
  for (const field of required) if (input[field] === undefined || input[field] === null || input[field] === '') throw new Error(`backup_${field}_required`);
  if (!input.encrypted) throw new Error('backup_encryption_required');
  if (input.frequencyMinutes <= 0 || input.retentionDays <= 0 || input.restoreTestIntervalDays <= 0) throw new Error('backup_invalid_interval');
  return Object.freeze({ ...input, version: 1 });
}

function verifyBackup(policy, evidence) {
  const integrityOk = evidence.checksumExpected === evidence.checksumObserved;
  const restorable = evidence.restoreCompleted === true && evidence.recordsVerified === true;
  return Object.freeze({ valid: integrityOk && restorable, integrityOk, restorable, verifiedAt: evidence.verifiedAt });
}

module.exports = { defineBackupPolicy, verifyBackup };
