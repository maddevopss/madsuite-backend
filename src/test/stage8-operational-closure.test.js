const { normalizeService } = require('../operations/serviceRegistry');
const { createIncident, transitionIncident } = require('../operations/incidentLifecycle');
const { createChange, approveChange, recordExecution } = require('../operations/changeManagement');
const { defineObjective, calculateServiceLevel } = require('../operations/serviceLevels');

describe('stage 8H operational closure', () => {
  test('runs a major incident exercise to verified restoration', () => {
    normalizeService({ id:'api', name:'API', criticality:'critical', owners:{ business:'product', technical:'backend', operational:'operations' } });
    let incident = createIncident({ id:'i-major', serviceId:'api', owner:'operations', impact:'service indisponible', severity:'critical' });
    incident = transitionIncident(incident,'contained',{ actor:'operations' });
    incident = transitionIncident(incident,'restored',{ actor:'backend', restorationProof:'fumée applicative réussie' });
    incident = transitionIncident(incident,'closed',{ actor:'operations', provisionalCause:'épuisement de connexions' });
    expect(incident.status).toBe('closed');
  });
  test('runs a failed change with verified rollback', () => {
    let change = createChange({ id:'c-major', serviceId:'api', owner:'backend', rollbackPlan:'restaurer version précédente', risk:'critical' });
    change = approveChange(change,{ actor:'operations' });
    change = recordExecution(change,{ startedAt:'2026-07-26T10:00:00Z', result:'failed', rollbackExecuted:true, proof:'version précédente active' });
    expect(change.status).toBe('rolled_back');
  });
  test('verifies measurable service levels', () => {
    const objective = defineObjective({ serviceId:'api', period:'monthly', targetAvailability:99.9 });
    expect(calculateServiceLevel(objective,{ totalMinutes:43200, downtimeMinutes:20, incidentCount:1 }).targetMet).toBe(true);
  });
});
