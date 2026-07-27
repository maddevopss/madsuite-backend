'use strict';

const { evaluateV1Certification } = require('../services/v1Certification.service');

const valid = {
  architectureVerified: true,
  securityVerified: true,
  tenantIsolationVerified: true,
  dataIntegrityVerified: true,
  operationsVerified: true,
  backupRestoreVerified: true,
  rollbackVerified: true,
  documentationVerified: true,
  complianceVerified: true,
  releaseCandidateVerified: true,
  releaseVersion: '1.0.0-rc.1',
  sourceCommit: '0123456789abcdef',
  approvedBy: 1,
  approvedAt: '2026-07-28T00:00:00Z',
};

describe('Bloc 20 — Certification V1', () => {
  test('certifie une version identifiée, complète et approuvée', () => {
    expect(evaluateV1Certification(valid)).toMatchObject({ certified: true, decision: 'certified' });
  });

  test('refuse une certification sans restauration vérifiée', () => {
    const result = evaluateV1Certification({ ...valid, backupRestoreVerified: false });
    expect(result.certified).toBe(false);
    expect(result.failedChecks).toContain('backupRestoreVerified');
  });

  test('refuse une certification sans commit source', () => {
    expect(evaluateV1Certification({ ...valid, sourceCommit: null }).certified).toBe(false);
  });
});