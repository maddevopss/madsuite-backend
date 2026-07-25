const { evaluatePolicy } = require('../services/business/transaction-engine.service');
require('../services/business/facilities-management-transaction.service');

const key = 'facilities-test-key';
const evaluate = (policy, input) => evaluatePolicy({ policy, input, idempotencyKey: key });

describe('facilities management transaction policies', () => {
  test('refuse un site sans responsable ni preuve', async () => {
    const result = await evaluate('facilities.site.create@1', { siteCode: 'S-1', name: 'Siège', siteType: 'office', evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('facilities.site_accountability_required');
  });

  test('refuse un espace sans responsabilité', async () => {
    const result = await evaluate('facilities.space.create@1', { siteId: 1, spaceCode: 'E-1', name: 'Entrepôt', spaceType: 'warehouse', evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('facilities.space_accountability_required');
  });

  test('refuse une inspection datée dans le futur', async () => {
    const result = await evaluate('facilities.inspection.complete@1', { subjectType: 'site', subjectId: 1, inspectorUserId: 2, inspectedAt: '2099-01-01T00:00:00Z', findings: ['ok'], evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('facilities.inspection_future_date');
  });

  test('refuse un transfert accepté par le demandeur', async () => {
    const result = await evaluate('facilities.transfer.accept@1', { subjectType: 'asset', subjectId: 1, requestedByUserId: 2, acceptedByUserId: 2, reason: 'Relocalisation', toSiteId: 3, evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('facilities.transfer_independent_acceptance_required');
  });

  test('refuse une mise hors service sans preuve', async () => {
    const result = await evaluate('facilities.asset.decommission@1', { assetId: 1, reason: 'Fin de vie', approvedByUserId: 3, evidence: [] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('facilities.decommission_evidence_required');
  });

  test('refuse une disposition auto-approuvée', async () => {
    const result = await evaluate('facilities.asset.dispose@1', { assetId: 1, disposalMethod: 'sale', reason: 'Surplus', requestedByUserId: 4, approvedByUserId: 4, residualValue: 100, evidence: ['proof'] });
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('facilities.disposal_independent_approval_required');
  });

  test('autorise une disposition indépendante et documentée', async () => {
    const result = await evaluate('facilities.asset.dispose@1', { assetId: 1, disposalMethod: 'sale', reason: 'Surplus', requestedByUserId: 4, approvedByUserId: 5, residualValue: 100, evidence: ['proof'] });
    expect(result.allowed).toBe(true);
    expect(result.code).toBe('facilities.asset_dispose_allowed');
  });
});
