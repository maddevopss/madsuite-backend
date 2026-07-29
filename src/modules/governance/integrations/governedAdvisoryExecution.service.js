'use strict';

const { evaluateCognitiveRecommendation } = require('./cognitiveAssistanceGovernance.service');
const { evaluateOperationalTransition } = require('./operationsGovernance.service');

function assertAllowed(result, code) {
  const allowed = result.allowed ?? result.executable ?? result.valid;
  if (!allowed) {
    const error = new Error(code);
    error.code = code;
    error.details = result.reasons || [];
    throw error;
  }
  return result;
}

function createGovernedAdvisoryExecution({ orchestrator }) {
  if (!orchestrator) throw new TypeError('orchestrator_required');

  return Object.freeze({
    async executeRecommendation({ recommendation, command, resourceOrganisationId, context, perform }) {
      const recommendationDecision = assertAllowed(
        evaluateCognitiveRecommendation(recommendation),
        'GOVERNANCE_RECOMMENDATION_DENIED',
      );
      if (!recommendationDecision.record.humanConfirmed) {
        const error = new Error('GOVERNANCE_HUMAN_CONFIRMATION_REQUIRED');
        error.code = 'GOVERNANCE_HUMAN_CONFIRMATION_REQUIRED';
        throw error;
      }
      const governanceDecision = orchestrator.evaluateGovernanceCommand({ command, resourceOrganisationId, ...context });
      const result = await perform();
      return Object.freeze({ result, recommendationDecision, governanceDecision });
    },

    async executeOperationalTransition({ transition, command, resourceOrganisationId, context, perform }) {
      const operationalDecision = assertAllowed(
        evaluateOperationalTransition(transition),
        'GOVERNANCE_OPERATION_TRANSITION_DENIED',
      );
      const governanceDecision = orchestrator.evaluateGovernanceCommand({ command, resourceOrganisationId, ...context });
      const result = await perform();
      return Object.freeze({ result, operationalDecision, governanceDecision });
    },
  });
}

module.exports = { createGovernedAdvisoryExecution };
