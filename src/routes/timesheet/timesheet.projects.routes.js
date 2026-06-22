const express = require("express");

const { getOrganisationId } = require("../../utils/organisationScope");
const { handleServiceError } = require("../../utils/routeError");
const timesheetService = require("../../services/timesheet/timesheet.service");
const ApiResponse = require("../../utils/apiResponse");

const router = express.Router();

router.get("/projets", async (req, res, next) => {
  try {
    const projects = await timesheetService.listProjects({
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("TIMESHEET_PROJECTS_LISTED", projects));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
