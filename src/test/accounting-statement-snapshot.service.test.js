const service = require('../services/business/accounting-statement-snapshot.service');

describe('accounting statement snapshots', () => {
  test('generates a stable hash for identical evidence', () => {
    const payload = { statementType: 'balance_sheet', asOfDate: '2026-12-31', payload: { assets: 100 }, totals: { assets: 100 } };
    expect(service.stableHash(payload)).toBe(service.stableHash(payload));
  });

  test('changes the hash when the statement changes', () => {
    expect(service.stableHash({ total: 100 })).not.toBe(service.stableHash({ total: 101 }));
  });
});
