'use strict';

const REQUIRED_STATES = Object.freeze([
  'observation',
  'analysis',
  'decision',
  'approval',
  'execution',
  'verification',
  'closure',
]);

async function runGovernanceContractSuite(adapter) {
  if (!adapter || typeof adapter.createCase !== 'function' || typeof adapter.transition !== 'function') {
    throw new TypeError('governance_adapter_invalid');
  }

  const report = [];
  const context = await adapter.createCase();

  for (const state of REQUIRED_STATES) {
    const result = await adapter.transition(context, state);
    report.push(Object.freeze({ state, accepted: result?.state === state }));
    if (result?.state !== state) break;
  }

  const passed = report.length === REQUIRED_STATES.length && report.every((item) => item.accepted);
  return Object.freeze({ passed, report: Object.freeze(report) });
}

function assertGovernanceContract(report) {
  if (!report?.passed) {
    const failed = report?.report?.find((item) => !item.accepted);
    const error = new Error(`governance_contract_failed:${failed?.state || 'unknown'}`);
    error.code = 'GOVERNANCE_CONTRACT_FAILED';
    throw error;
  }
  return true;
}

module.exports = { REQUIRED_STATES, runGovernanceContractSuite, assertGovernanceContract };
