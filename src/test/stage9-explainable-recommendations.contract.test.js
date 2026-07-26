const { createRecommendation } = require('../ai/explainableRecommendation');

describe('stage 9C explainable recommendations', () => {
  const input = { useCaseId: 'billing-review', recommendation: 'Vérifier la facture', reasons: ['écart détecté'], evidence: [{ sourceId: 'invoice:7', kind: 'fact' }], limits: ['données partielles'], confidence: 0.72, expiresAt: new Date(Date.now() + 60000).toISOString() };
  test('is advisory and non executable', () => {
    expect(createRecommendation(input)).toEqual(expect.objectContaining({ authority: 'advisory', executable: false, contract: 'explainable-recommendation@1' }));
  });
  test('requires identifiable evidence', () => {
    expect(() => createRecommendation({ ...input, evidence: [] })).toThrow('ai.recommendation.evidence_required');
  });
});
