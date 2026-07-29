'use strict';

function linkDecisionEvidenceResult(input) {
  return {
    organisationId: input.organisationId,
    decisionId: input.decisionId,
    evidenceId: input.evidenceId,
    resultId: input.resultId || null,
    relation: input.relation || 'supports',
    linkedAt: input.linkedAt || new Date().toISOString(),
  };
}

module.exports = { linkDecisionEvidenceResult };
