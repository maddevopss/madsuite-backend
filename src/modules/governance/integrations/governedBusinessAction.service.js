'use strict';

const { evaluateAccountingDecision } = require('./accountingGovernance.service');
const { evaluatePayrollDecision } = require('./payrollGovernance.service');
const { evaluateInventoryMovement } = require('./inventoryGovernance.service');
const { evaluateSupplierDecision } = require('./supplierGovernance.service');

const EVALUATORS = Object.freeze({
  accounting: evaluateAccountingDecision,
  payroll: evaluatePayrollDecision,
  inventory: evaluateInventoryMovement,
  supplier: evaluateSupplierDecision,
});

function createGovernedBusinessAction({ orchestrator, repository, integrityService }) {
  if (!orchestrator || !repository || !integrityService) throw new TypeError('governance_dependencies_required');

  return async function executeGovernedBusinessAction({ domain, domainInput, command, resourceOrganisationId, assignments, approvalPolicy, approvals, exception, stopContext, perform }) {
    const evaluator = EVALUATORS[domain];
    if (!evaluator) {
      const error = new Error('GOVERNANCE_DOMAIN_UNSUPPORTED');
      error.code = 'GOVERNANCE_DOMAIN_UNSUPPORTED';
      throw error;
    }
    if (typeof perform !== 'function') throw new TypeError('perform_required');

    const domainDecision = evaluator(domainInput);
    if (!(domainDecision.allowed ?? domainDecision.valid ?? domainDecision.executable)) {
      const error = new Error('GOVERNANCE_DOMAIN_RULES_DENIED');
      error.code = 'GOVERNANCE_DOMAIN_RULES_DENIED';
      error.details = domainDecision.reasons || [];
      throw error;
    }

    const governanceDecision = orchestrator.evaluateGovernanceCommand({
      command,
      resourceOrganisationId,
      assignments,
      approvalPolicy,
      approvals,
      exception,
      stopContext,
    });

    const result = await perform();
    return Object.freeze({ result, governanceDecision, domainDecision });
  };
}

module.exports = { EVALUATORS, createGovernedBusinessAction };
