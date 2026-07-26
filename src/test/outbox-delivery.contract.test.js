const { prepareDelivery, markDelivered, markFailed, reconcileDeliveries } = require('../operations/outboxDelivery');

describe('outbox delivery contract', () => {
  const event = { type: 'invoice.finalized', aggregateId: 'inv-7', version: 2 };

  test('creates a stable deduplication key', () => {
    const delivery = prepareDelivery(event, new Date('2026-01-01T00:00:00Z'));
    expect(delivery.key).toBe('invoice.finalized:inv-7:v2');
  });

  test('tracks failures and successful delivery', () => {
    const pending = prepareDelivery(event);
    const failed = markFailed(pending, { code: 'transport.timeout' });
    const delivered = markDelivered(failed, new Date('2026-01-01T00:01:00Z'));
    expect(delivered).toEqual(expect.objectContaining({ status: 'delivered', attempts: 2, lastError: null }));
  });

  test('reconciles duplicate observations by key', () => {
    const pending = prepareDelivery(event);
    const delivered = markDelivered(pending);
    const report = reconcileDeliveries([pending, delivered]);
    expect(report.deliveries).toHaveLength(1);
    expect(report.pending).toBe(0);
  });
});
