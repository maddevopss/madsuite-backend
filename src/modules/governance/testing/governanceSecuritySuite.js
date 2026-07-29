'use strict';

const SECURITY_SCENARIOS = Object.freeze([
  'cross_organisation_read',
  'cross_organisation_write',
  'missing_actor',
  'missing_approval',
  'self_approval',
  'expired_exception',
  'tampered_evidence',
]);

async function runGovernanceSecuritySuite(adapter) {
  if (!adapter || typeof adapter.executeScenario !== 'function') {
    throw new TypeError('security_adapter_invalid');
  }

  const results = [];
  for (const scenario of SECURITY_SCENARIOS) {
    try {
      await adapter.executeScenario(scenario);
      results.push(Object.freeze({ scenario, denied: false, code: null }));
    } catch (error) {
      results.push(Object.freeze({ scenario, denied: true, code: error.code || error.message }));
    }
  }

  const passed = results.every((result) => result.denied);
  return Object.freeze({ passed, results: Object.freeze(results) });
}

function assertGovernanceSecurity(report) {
  const failures = report?.results?.filter((result) => !result.denied) || [];
  if (!report?.passed || failures.length) {
    const error = new Error(`governance_security_failed:${failures.map((item) => item.scenario).join(',')}`);
    error.code = 'GOVERNANCE_SECURITY_FAILED';
    throw error;
  }
  return true;
}

module.exports = { SECURITY_SCENARIOS, runGovernanceSecuritySuite, assertGovernanceSecurity };
