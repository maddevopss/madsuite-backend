const { getDashboardStats } = require("./timesheet-stats.service");
const { listProjects, listEntries } = require("./timesheet-query.service");
const { createManualEntry, updateEntry, setEntryBilled, deleteEntry } = require("./timesheet-mutation.service");
const { setEntryStatus } = require("./timesheet-approval.service");

module.exports = {
  getDashboardStats,
  listProjects,
  listEntries,
  createManualEntry,
  updateEntry,
  setEntryBilled,
  deleteEntry,
  setEntryStatus,
};
