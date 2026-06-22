/**
 * timesheet-approved.event.js
 */

const eventBus = require("./event-bus.service");

const TIMESHEET_APPROVED = "TIMESHEET_APPROVED";

function publishTimesheetApproved(timeEntry) {
  eventBus.publish(TIMESHEET_APPROVED, {
    entryId: timeEntry.id,
    organisationId: timeEntry.organisation_id,
    projetId: timeEntry.projet_id,
    userId: timeEntry.utilisateur_id,
    timestamp: new Date()
  });
}

module.exports = {
  TIMESHEET_APPROVED,
  publishTimesheetApproved
};
