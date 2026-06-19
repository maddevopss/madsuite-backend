const router = require("express").Router();
const timeEntryController = require("../controllers/timeEntryController");
const { requireOrganisation } = require("../middleware/organization.middleware");
const dashboardRoutes = require("./timesheet/timesheet.dashboard.routes");
const projectsRoutes = require("./timesheet/timesheet.projects.routes");
const entriesRoutes = require("./timesheet/timesheet.entries.routes");

router.use(requireOrganisation);

router.get("/", timeEntryController.getTimeEntries);
router.post("/", timeEntryController.createTimeEntry);
router.use("/", dashboardRoutes);
router.use("/", projectsRoutes);
router.use("/", entriesRoutes);

module.exports = router;
