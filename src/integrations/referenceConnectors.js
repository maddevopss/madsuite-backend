'use strict';

const REFERENCE_CONNECTORS = Object.freeze([
  { id: 'accounting', capabilities: ['journal.export', 'payment.import'], sourceOfTruth: false },
  { id: 'calendar', capabilities: ['event.read', 'event.write'], sourceOfTruth: false },
  { id: 'messaging', capabilities: ['message.send'], sourceOfTruth: false },
  { id: 'document-storage', capabilities: ['document.read', 'document.write'], sourceOfTruth: false },
  { id: 'structured-transfer', capabilities: ['import.validate', 'export.generate'], sourceOfTruth: false }
]);

function activateConnector(connector, decision) {
  if (!connector || !REFERENCE_CONNECTORS.some((item) => item.id === connector.id)) throw new Error('connector.unknown');
  if (!decision || decision.approved !== true || !decision.humanActorId) throw new Error('connector.human_decision.required');
  if (decision.sourceOfTruth === true && decision.explicitSourceOfTruthApproval !== true) {
    throw new Error('connector.source_of_truth.explicit_approval_required');
  }
  return Object.freeze({ ...connector, active: true, sourceOfTruth: decision.sourceOfTruth === true, approvedBy: decision.humanActorId });
}

module.exports = { REFERENCE_CONNECTORS, activateConnector };
