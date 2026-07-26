const { createChange, approveChange, recordExecution } = require('../operations/changeManagement');
describe('stage 8D changes', () => {
  const change = createChange({ id:'c1', serviceId:'api', owner:'backend', rollbackPlan:'revenir à la version précédente', risk:'high' });
  test('requires independent approval', () => expect(() => approveChange(change,{ actor:'backend' })).toThrow('change.independent_approval_required'));
  test('requires rollback on failure', () => expect(() => recordExecution(change,{ startedAt:'2026-01-01', result:'failed' })).toThrow('change.rollback_required'));
  test('records success', () => expect(recordExecution(change,{ startedAt:'2026-01-01', result:'succeeded' }).status).toBe('completed'));
});
