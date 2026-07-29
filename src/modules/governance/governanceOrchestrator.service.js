'use strict';

const { validateGovernanceCommand } = require('./api/governanceApi.contract');
const { validateSeparationOfDuties } = require('./separationOfDuties.service');
const { evaluateApprovalPolicy } = require('./approvalPolicy.service');
const { canUseException } = require('./exceptionPolicy.service');
const { evaluateStopRules } = require('./stopRules.service');
const { assertSameOrganisation } = require('./security/governanceTenantGuard.service');

const GOVERNANCE_STATES = Object.freeze([
  'observation', 'analysis', 'decision', 'approval', 'execution', 'verification', 'closure',
]);

const ACTION_TO_STATE = Object.freeze({
  observe: 'observation',
  define_need: 'analysis',
  review_options: 'analysis',
  assess_risks: 'analysis',
  attach_evidence: 'analysis',
  decide: 'decision',
  approve: 'approval',
  authorize_execution: 'execution',
  verify_result: 'verification',
  review: 'verification',
  close: 'closure',
});

function createGovernanceError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

function evaluateGovernanceCommand(input = {}) {
  const { command = {}, resourceOrganisationId, assignments = [], approvalPolicy = {}, approvals = [], exception = null, stopContext = {} } = input;
  const validation = validateGovernanceCommand(command);
  if (!validation.valid) throw createGovernanceError('GOVERNANCE_COMMAND_INVALID', { errors: validation.errors });

  assertSameOrganisation({ actorOrganisationId: command.organisationId, resourceOrganisationId });

  const duties = validateSeparationOfDuties(assignments);
  const approval = evaluateApprovalPolicy({ ...approvalPolicy, approvals });
  const exceptionResult = exception ? canUseException(exception, { organisationId: command.organisationId }) : null;
  const stop = evaluateStopRules({
    ...stopContext,
    hasRequiredApprovals: approval.approved,
    hasDutyConflict: !duties.valid,
  });

  if (stop.stopped && !exceptionResult?.active) {
    throw createGovernanceError('GOVERNANCE_EXECUTION_STOPPED', { reasons: stop.reasons });
  }

  return Object.freeze({
    allowed: true,
    action: command.action,
    targetState: ACTION_TO_STATE[command.action],
    organisationId: String(command.organisationId),
    aggregateType: command.aggregateType,
    aggregateId: String(command.aggregateId),
    actorId: String(command.actorId),
    idempotencyKey: command.idempotencyKey,
    exceptionUsed: Boolean(exceptionResult?.active),
  });
}

module.exports = { GOVERNANCE_STATES, ACTION_TO_STATE, createGovernanceError, evaluateGovernanceCommand };
