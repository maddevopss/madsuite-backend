'use strict';

const {
  REQUIRED_POST_DEPLOY_CHECKS,
  evaluateControlledPublication,
} = require('../services/controlledPublicationOperation.service');

describe('controlled publication operations complete block', () => {
  const completeChecks = Object.fromEntries(
    REQUIRED_POST_DEPLOY_CHECKS.map((check) => [check, true]),
  );

  test('autorise la fermeture seulement avec preuves, retour arrière et approbation humaine', () => {
    expect(
      evaluateControlledPublication({
        readinessGateApproved: true,
        releaseIdentifier: '2026.07.27-1',
        sourceCommitSha: 'abc123',
        rollbackPlanVerified: true,
        evidenceComplete: true,
        postDeployChecks: completeChecks,
        criticalIncidentOpen: false,
        approvedBy: 42,
        approvedAt: '2026-07-27T23:30:00.000Z',
      }),
    ).toEqual(
      expect.objectContaining({
        allowed: true,
        technicallyComplete: true,
        humanApprovalPresent: true,
        blockers: [],
        recommendedStatus: 'completed',
      }),
    );
  });

  test('refuse une publication sans vérification d’isolation', () => {
    const result = evaluateControlledPublication({
      readinessGateApproved: true,
      releaseIdentifier: '2026.07.27-2',
      sourceCommitSha: 'def456',
      rollbackPlanVerified: true,
      evidenceComplete: true,
      postDeployChecks: { ...completeChecks, tenantIsolation: false },
      approvedBy: 42,
      approvedAt: '2026-07-27T23:30:00.000Z',
    });

    expect(result.allowed).toBe(false);
    expect(result.missingChecks).toContain('tenantIsolation');
    expect(result.blockers).toContain('post_deploy_checks_incomplete');
  });

  test('préserve la décision humaine même lorsque les contrôles techniques passent', () => {
    const result = evaluateControlledPublication({
      readinessGateApproved: true,
      releaseIdentifier: '2026.07.27-3',
      sourceCommitSha: 'ghi789',
      rollbackPlanVerified: true,
      evidenceComplete: true,
      postDeployChecks: completeChecks,
    });

    expect(result.technicallyComplete).toBe(true);
    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain('human_approval_missing');
  });
});
