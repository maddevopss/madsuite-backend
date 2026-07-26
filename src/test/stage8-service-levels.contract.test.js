const { defineObjective, calculateServiceLevel } = require('../operations/serviceLevels');
describe('stage 8E service levels', () => {
  const objective = defineObjective({ serviceId:'api', period:'monthly', targetAvailability:99.9, targetRestoreMinutes:60 });
  test('calculates availability and error budget', () => expect(calculateServiceLevel(objective,{ totalMinutes:43200, downtimeMinutes:20, incidentCount:1 })).toEqual(expect.objectContaining({ targetMet:true, incidentCount:1 })));
  test('detects exhausted budget without hiding incidents', () => { const result = calculateServiceLevel(objective,{ totalMinutes:43200, downtimeMinutes:60, incidentCount:2 }); expect(result.targetMet).toBe(false); expect(result.incidentCount).toBe(2); });
  test('rejects invalid observations', () => expect(() => calculateServiceLevel(objective,{ totalMinutes:10, downtimeMinutes:11 })).toThrow('slo.observation_invalid'));
});
