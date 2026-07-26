'use strict';
const { defineDisasterRecoveryPlan, assessExercise } = require('../resilience/disasterRecoveryPlan');
describe('stage 13E disaster recovery', () => {
  test('measures RTO and RPO', () => {
    const plan = defineDisasterRecoveryPlan({ scenario: 'database-loss', owner: 'ops', rtoMinutes: 60, rpoMinutes: 15, communicationChannel: 'incident-room', steps: ['declare','restore','verify'] });
    expect(assessExercise(plan, { recoveryMinutes: 45, dataLossMinutes: 10, communicationCompleted: true }).passed).toBe(true);
  });
});
