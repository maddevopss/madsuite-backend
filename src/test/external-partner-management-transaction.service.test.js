const { evaluatePolicy } = require('../services/business/transaction-engine.service');
require('../services/business/external-partner-management-transaction.service');

const key = 'partners-test-key';
const evaluate = (policy, input) => evaluatePolicy({ policy, input, idempotencyKey: key });

describe('external partner management transaction policies', () => {
  test('refuse un partenaire sans responsable ni preuve', async () => {
    const result = await evaluate('partners.partner.register@1', { partnerCode: 'P-1', legalName: 'Partenaire', partnerType: 'authority', evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('partners.partner_accountability_required');
  });

  test('refuse une entente dont la période est invalide', async () => {
    const result = await evaluate('partners.agreement.approve@1', { partnerId: 1, agreementNumber: 'A-1', agreementType: 'service', title: 'Entente', effectiveFrom: '2027-01-01', effectiveTo: '2026-01-01', ownerUserId: 1, approvedByUserId: 2, responsibilities: ['service'], evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('partners.agreement_period_invalid');
  });

  test('refuse une entente auto-approuvée', async () => {
    const result = await evaluate('partners.agreement.approve@1', { partnerId: 1, agreementNumber: 'A-1', agreementType: 'service', title: 'Entente', effectiveFrom: '2026-01-01', ownerUserId: 2, approvedByUserId: 2, responsibilities: ['service'], evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('partners.agreement_independent_approval_required');
  });

  test('refuse une certification sans preuve', async () => {
    const result = await evaluate('partners.certification.verify@1', { partnerId: 1, certificationType: 'insurance', issuedBy: 'Assureur', verifiedByUserId: 3, evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('partners.certification_evidence_required');
  });

  test('refuse une évaluation future', async () => {
    const result = await evaluate('partners.assessment.complete@1', { partnerId: 1, assessmentType: 'annual', assessedAt: '2099-01-01T00:00:00Z', assessedByUserId: 4, riskLevel: 'high', criteria: ['delivery'], evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('partners.assessment_future_date');
  });

  test('refuse un incident sans preuve', async () => {
    const result = await evaluate('partners.incident.report@1', { partnerId: 1, occurredAt: '2026-01-01T00:00:00Z', incidentType: 'service_failure', severity: 'high', description: 'Interruption', responsibleUserId: 5, evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('partners.incident_evidence_required');
  });

  test('autorise une entente complète et approuvée indépendamment', async () => {
    const result = await evaluate('partners.agreement.approve@1', { partnerId: 1, agreementNumber: 'A-2', agreementType: 'service', title: 'Entente', effectiveFrom: '2026-01-01', ownerUserId: 2, approvedByUserId: 3, responsibilities: ['service'], evidence: ['proof'] });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('partners.agreement_approve_allowed');
  });
});