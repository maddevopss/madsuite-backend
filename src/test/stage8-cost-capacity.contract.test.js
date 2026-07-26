const { recordUsage, summarizeCapacity } = require('../operations/costCapacity');
describe('stage 8F cost and capacity', () => {
  test('avoids financial double counting', () => { const result = summarizeCapacity([recordUsage({ serviceId:'api', period:'2026-07', metric:'requests', quantity:10, unitCost:2, financialReference:'ledger-1' })]); expect(result.operationalCost).toBe(0); });
  test('raises capacity alerts', () => { const result = summarizeCapacity([recordUsage({ serviceId:'api', period:'2026-07', metric:'storage_gb', quantity:90 })], { storage_gb:80 }); expect(result.alerts).toHaveLength(1); });
  test('rejects duplicate records', () => { const item = recordUsage({ serviceId:'api', period:'2026-07', metric:'jobs', quantity:1 }); expect(() => summarizeCapacity([item,item])).toThrow('capacity.duplicate_record'); });
});
