const { evaluatePolicy } = require('../services/business/transaction-engine.service');
const {
  ASSET_CREATE_POLICY,
  WORK_ORDER_CREATE_POLICY,
  WORK_ORDER_TRANSITION_POLICY,
  USAGE_READING_POLICY,
  nonNegativeMoney,
} = require('../services/business/asset-maintenance-transaction.service');

describe('asset maintenance transactional core', () => {
  test('refuse un actif sans identité minimale', async () => {
    const decision = await evaluatePolicy({ policy: ASSET_CREATE_POLICY, input: { assetType: 'vehicle' }, idempotencyKey: 'asset-create-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.identity_required');
  });

  test('refuse une valeur d acquisition négative', async () => {
    const decision = await evaluatePolicy({ policy: ASSET_CREATE_POLICY, input: { assetCode: 'V-001', name: 'Camion', assetType: 'vehicle', acquisitionCost: -1 }, idempotencyKey: 'asset-create-002' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.value_invalid');
  });

  test('accepte les valeurs monétaires nulles ou positives', () => {
    expect(nonNegativeMoney(null)).toBe(true);
    expect(nonNegativeMoney(0)).toBe(true);
    expect(nonNegativeMoney(1250.50)).toBe(true);
    expect(nonNegativeMoney(-0.01)).toBe(false);
  });

  test('refuse un bon de travail incomplet', async () => {
    const decision = await evaluatePolicy({ policy: WORK_ORDER_CREATE_POLICY, input: { assetId: 1 }, idempotencyKey: 'work-order-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.work_order_incomplete');
  });

  test('refuse une complétion sans preuve', async () => {
    const decision = await evaluatePolicy({ policy: WORK_ORDER_TRANSITION_POLICY, input: { workOrderId: 1, action: 'completed', reason: 'Entretien effectué', evidence: [] }, idempotencyKey: 'work-order-complete-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.completion_evidence_required');
  });

  test('refuse une complétion sans raison', async () => {
    const decision = await evaluatePolicy({ policy: WORK_ORDER_TRANSITION_POLICY, input: { workOrderId: 1, action: 'completed', evidence: [{ id: 'photo' }] }, idempotencyKey: 'work-order-complete-002' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.completion_reason_required');
  });

  test('refuse une annulation sans raison', async () => {
    const decision = await evaluatePolicy({ policy: WORK_ORDER_TRANSITION_POLICY, input: { workOrderId: 1, action: 'cancelled' }, idempotencyKey: 'work-order-cancel-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.cancellation_reason_required');
  });

  test('refuse des coûts négatifs', async () => {
    const decision = await evaluatePolicy({ policy: WORK_ORDER_TRANSITION_POLICY, input: { workOrderId: 1, action: 'assigned', labourCost: -10 }, idempotencyKey: 'work-order-cost-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.cost_invalid');
  });

  test('refuse un relevé d usage négatif', async () => {
    const decision = await evaluatePolicy({ policy: USAGE_READING_POLICY, input: { assetId: 1, readingValue: -1, readingUnit: 'km', measuredAt: '2026-07-25T12:00:00Z' }, idempotencyKey: 'usage-reading-001' });
    expect(decision.allowed).toBe(false);
    expect(decision.code).toBe('assets.reading_invalid');
  });
});
