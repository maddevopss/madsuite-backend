const { createIncident, transitionIncident } = require('../operations/incidentLifecycle');
describe('stage 8B incidents', () => {
  const incident = createIncident({ id:'i1', serviceId:'api', owner:'ops', impact:'indisponible', severity:'major' });
  test('requires sequential transitions', () => expect(() => transitionIncident(incident, 'restored')).toThrow('incident.transition_invalid'));
  test('requires restoration proof', () => expect(() => transitionIncident({ ...incident, status:'contained' }, 'restored')).toThrow('incident.restoration_proof_required'));
  test('records a valid transition', () => expect(transitionIncident(incident, 'contained', { actor:'ops' }).timeline).toHaveLength(1));
});
