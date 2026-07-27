const service = require('../services/business/inventory-traceability.service');

describe('inventory traceability', () => {
  test('classifies expired and recalled lots', () => {
    expect(service.classifyLotStatus({ expiresAt: '2026-01-01', remainingQuantity: 2 }, new Date('2026-07-27'))).toBe('expired');
    expect(service.classifyLotStatus({ recalled: true, remainingQuantity: 2 })).toBe('recalled');
  });

  test('summarizes trace events', () => {
    const summary = service.buildTraceSummary([
      { eventType: 'received', occurredAt: '2026-01-01' },
      { eventType: 'issued', occurredAt: '2026-01-03' },
      { eventType: 'issued', occurredAt: '2026-01-04' },
    ]);
    expect(summary.totalEvents).toBe(3);
    expect(summary.byType.issued).toBe(2);
  });
});
