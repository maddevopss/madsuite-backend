const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const {
  PROGRAM_CREATE_POLICY,
  FINDING_CREATE_POLICY,
  ACTION_TRANSITION_POLICY,
  FINDING_CLOSE_POLICY,
  FOLLOWUP_COMPLETE_POLICY,
} = require('../services/business/internal-audit-transaction.service');

const context = (policy, input, idempotencyKey = 'audit-test-001') => ({ policy, input, idempotencyKey });

describe('internal audit transaction policies', () => {
  test('refuse un programme sans base de risque', async () => {
    const result = await evaluatePolicy(context(PROGRAM_CREATE_POLICY, {
      programNumber: 'AUD-2026', title: 'Programme annuel', objectives: 'Vérifier les contrôles',
      periodStart: '2026-01-01', periodEnd: '2026-12-31', ownerUserId: 42, scope: ['organisation'], riskBasis: [],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('audit.program_basis_required');
  });

  test('refuse un constat majeur sans preuve', async () => {
    const result = await evaluatePolicy(context(FINDING_CREATE_POLICY, {
      engagementId: 1, findingNumber: 'F-001', classification: 'major', title: 'Contrôle absent',
      description: 'Le contrôle attendu est absent', criterion: 'POL-001', ownerUserId: 42, evidence: [],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('audit.material_finding_evidence_required');
  });

  test('refuse une action vérifiée sans preuve d’efficacité', async () => {
    const result = await evaluatePolicy(context(ACTION_TRANSITION_POLICY, {
      actionId: 1, action: 'verified', implementationResult: 'Implanté', implementationEvidence: ['doc-1'],
      effectivenessResult: '', verificationEvidence: [],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('audit.action_effectiveness_proof_required');
  });

  test('refuse la fermeture d’un constat avec actions ouvertes', async () => {
    const result = await evaluatePolicy(context(FINDING_CLOSE_POLICY, {
      findingId: 1, closureReason: 'Corrigé', evidence: ['preuve-1'], openActionsCount: 1,
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('audit.finding_open_actions');
  });

  test('refuse un suivi additionnel sans prochaine date', async () => {
    const result = await evaluatePolicy(context(FOLLOWUP_COMPLETE_POLICY, {
      engagementId: 1, followupNumber: 'S-001', reviewerUserId: 42, conclusion: 'Travail additionnel requis',
      status: 'additional_action_required', evidence: ['preuve-1'],
    }));
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('audit.next_followup_required');
  });
});
