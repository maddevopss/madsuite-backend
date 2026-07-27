'use strict';

const {
  REQUIRED_BOOLEAN_CHECKS,
  evaluateProductionReadiness,
} = require('../services/productionReadinessGate.service');

function validInput(overrides = {}) {
  return {
    configurationValidated: true,
    migrationsValidated: true,
    healthchecksValidated: true,
    tenantIsolationValidated: true,
    backupRestoreValidated: true,
    rollbackValidated: true,
    monitoringValidated: true,
    unresolvedCriticalFindings: 0,
    evidence: { ci: 'green', restoreDrill: 'passed' },
    approvedBy: 1,
    approvedAt: '2026-07-27T23:30:00.000Z',
    ...overrides,
  };
}

describe('production readiness gate', () => {
  test('déclare la version prête lorsque toutes les preuves et validations sont présentes', () => {
    expect(evaluateProductionReadiness(validInput())).toEqual({
      ready: true,
      failures: [],
      decisionAuthority: 'human',
    });
  });

  test.each(REQUIRED_BOOLEAN_CHECKS)('bloque lorsque %s manque', check => {
    const result = evaluateProductionReadiness(validInput({ [check]: false }));
    expect(result.ready).toBe(false);
    expect(result.failures).toContain(check);
  });

  test('bloque les constats critiques non résolus', () => {
    const result = evaluateProductionReadiness(validInput({ unresolvedCriticalFindings: 1 }));
    expect(result.ready).toBe(false);
    expect(result.failures).toContain('unresolvedCriticalFindings');
  });

  test('bloque sans preuve exploitable', () => {
    const result = evaluateProductionReadiness(validInput({ evidence: {} }));
    expect(result.failures).toContain('evidenceMissing');
  });

  test('préserve la décision finale humaine', () => {
    const result = evaluateProductionReadiness(validInput({ approvedBy: null, approvedAt: null }));
    expect(result.ready).toBe(false);
    expect(result.failures).toContain('humanApprovalMissing');
    expect(result.decisionAuthority).toBe('human');
  });
});
