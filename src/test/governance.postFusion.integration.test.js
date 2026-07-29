'use strict';

const { validateGovernanceCommand } = require('../modules/governance/api/governanceApi.contract');
const { assertSameOrganisation } = require('../modules/governance/security/governanceTenantGuard.service');
const { signGovernanceRecord, verifyGovernanceRecord } = require('../modules/governance/integrity/governanceIntegrity.service');
const { evaluateAccountingDecision } = require('../modules/governance/integrations/accountingGovernance.service');
const { evaluateCognitiveRecommendation } = require('../modules/governance/integrations/cognitiveAssistanceGovernance.service');
const { runGovernanceSecuritySuite, assertGovernanceSecurity } = require('../modules/governance/testing/governanceSecuritySuite');

const validCommand = {
  organisationId: 'org-a',
  aggregateType: 'journal_entry',
  aggregateId: 'entry-1',
  action: 'approve',
  actorId: 'user-1',
  idempotencyKey: 'idem-1',
};

describe('gouvernance post-fusion', () => {
  test('valide le contrat de commande complet', () => {
    expect(validateGovernanceCommand(validCommand)).toMatchObject({ valid: true, errors: [] });
  });

  test('refuse strictement un accès entre organisations', () => {
    expect(() => assertSameOrganisation({ actorOrganisationId: 'org-a', resourceOrganisationId: 'org-b' }))
      .toThrow('cross_organisation_access_denied');
  });

  test('détecte une preuve altérée', () => {
    const secret = 'secret-test-only';
    const payload = { amount: 1250, organisationId: 'org-a' };
    const envelope = signGovernanceRecord(payload, secret);
    expect(verifyGovernanceRecord(payload, envelope, secret)).toBe(true);
    expect(verifyGovernanceRecord({ ...payload, amount: 9999 }, envelope, secret)).toBe(false);
  });

  test('exige deux approbations pour une écriture comptable de 10 000 $ ou plus', () => {
    const result = evaluateAccountingDecision({
      organisationId: 'org-a', actorId: 'user-1', action: 'journal_entry.create',
      amount: 10000, evidenceIds: ['proof-1'], approvalIds: ['approval-1'],
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('DOUBLE_APPROVAL_REQUIRED');
  });

  test('empêche l’exécution cognitive sans confirmation humaine', () => {
    const result = evaluateCognitiveRecommendation({
      organisationId: 'org-a', recommendationId: 'rec-1', contextSources: ['ctx-1'],
      policyIds: ['policy-1'], evidenceIds: ['proof-1'], confidence: 0.8,
      explanation: 'Explication vérifiable', limitations: [], humanConfirmed: false,
    });
    expect(result.executable).toBe(false);
    expect(result.reasons).toContain('HUMAN_CONFIRMATION_REQUIRED');
  });

  test('la suite de sécurité exige le refus de chaque scénario', async () => {
    const expectedCodes = {
      cross_organisation_read: 'GOVERNANCE_CROSS_ORGANISATION_DENIED',
      cross_organisation_write: 'GOVERNANCE_CROSS_ORGANISATION_DENIED',
      missing_actor: 'GOVERNANCE_ACTOR_REQUIRED',
      missing_approval: 'GOVERNANCE_APPROVAL_REQUIRED',
      self_approval: 'GOVERNANCE_SELF_APPROVAL_DENIED',
      expired_exception: 'GOVERNANCE_EXCEPTION_EXPIRED',
      tampered_evidence: 'GOVERNANCE_EVIDENCE_TAMPERED',
    };
    const report = await runGovernanceSecuritySuite({
      async executeScenario(scenario) {
        const error = new Error(expectedCodes[scenario]);
        error.code = expectedCodes[scenario];
        throw error;
      },
    });
    expect(assertGovernanceSecurity(report)).toBe(true);
  });
});
