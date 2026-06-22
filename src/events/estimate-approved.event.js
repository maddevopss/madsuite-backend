/**
 * estimate-approved.event.js
 */

const eventBus = require("./event-bus.service");

const ESTIMATE_APPROVED = "ESTIMATE_APPROVED";

function publishEstimateApproved(estimate) {
  eventBus.publish(ESTIMATE_APPROVED, {
    estimateId: estimate.id,
    organisationId: estimate.organisation_id,
    clientId: estimate.client_id,
    timestamp: new Date()
  });
}

module.exports = {
  ESTIMATE_APPROVED,
  publishEstimateApproved
};
