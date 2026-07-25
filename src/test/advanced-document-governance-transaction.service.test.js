const { evaluatePolicy } = require('../services/business/transaction-engine.service');
require('../services/business/advanced-document-governance-transaction.service');

const key = 'documents-test-key';
const evaluate = (policy, input) => evaluatePolicy({ policy, input, idempotencyKey: key });

describe('advanced document governance transaction policies', () => {
  test('refuse une classification sans preuve', async () => {
    const result = await evaluate('documents.classification.create@1', { classificationCode: 'CONF', name: 'Confidentiel', ownerUserId: 1, retentionYears: 7, evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('documents.classification_evidence_required');
  });

  test('refuse une version auto-approuvée', async () => {
    const result = await evaluate('documents.version.approve@1', { documentId: 1, versionNumber: 2, contentHash: 'abc', storageRef: 'proof://v2', preparedByUserId: 4, approvedByUserId: 4, evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('documents.version_independent_approval_required');
  });

  test('refuse une publication future non autorisée', async () => {
    const result = await evaluate('documents.document.publish@1', { documentId: 1, approvedVersionId: 2, publishedByUserId: 5, effectiveAt: '2999-01-01', evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('documents.future_effective_date_not_authorized');
  });

  test('bloque la destruction sous gel juridique', async () => {
    const result = await evaluate('documents.retention.execute@1', { documentId: 1, actionType: 'destroy', reason: 'Fin de conservation', requestedByUserId: 1, approvedByUserId: 2, executedByUserId: 3, legalHold: true, evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('documents.legal_hold_blocks_destruction');
  });

  test('exige une séparation des responsabilités', async () => {
    const result = await evaluate('documents.retention.execute@1', { documentId: 1, actionType: 'archive', reason: 'Fin de cycle', requestedByUserId: 1, approvedByUserId: 2, executedByUserId: 2, evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('documents.retention_separation_of_duties_required');
  });

  test('refuse une revue d’accès future', async () => {
    const result = await evaluate('documents.access_review.complete@1', { documentId: 1, reviewedByUserId: 7, reviewedAt: '2999-01-01', authorizedRoles: ['legal'], evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('documents.access_review_future_date');
  });

  test('autorise une action de conservation documentée et indépendante', async () => {
    const result = await evaluate('documents.retention.execute@1', { documentId: 1, actionType: 'archive', reason: 'Fin de cycle', requestedByUserId: 1, approvedByUserId: 2, executedByUserId: 3, legalHold: false, evidence: ['proof'] });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('documents.retention_execute_allowed');
  });
});
