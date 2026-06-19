const express = require("express");

const { getOrganisationId } = require("../../utils/organisationScope");
const { handleServiceError } = require("../../utils/routeError");
const timesheetService = require("../../services/timesheet.service");
const ApiResponse = require("../../utils/apiResponse");

const router = express.Router();

router.get("/dashboard", async (req, res, next) => {
  try {
    const stats = await timesheetService.getDashboardStats({
      userId: req.user.id,
      role: req.user?.role,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("TIMESHEET_DASHBOARD_LISTED", stats));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
