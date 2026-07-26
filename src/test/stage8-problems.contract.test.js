const { createProblem, recordRootCause, verifyCorrectiveAction } = require('../operations/problemManagement');
describe('stage 8C problems', () => {
  const problem = createProblem({ id:'p1', serviceId:'api', incidentIds:['i1','i2'] });
  test('tracks recurrence', () => expect(problem.recurrenceCount).toBe(2));
  test('requires cause evidence', () => expect(() => recordRootCause(problem,{ cause:'pool épuisé' })).toThrow('problem.root_cause_evidence_required'));
  test('verifies corrective action', () => expect(verifyCorrectiveAction(problem,{ id:'a1', owner:'backend', verification:'test de charge' }).status).toBe('verified'));
});
