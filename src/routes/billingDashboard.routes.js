const express = require("express");
const router = express.Router();

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const billingDashboardService = require("../services/billingDashboard.service");
const ApiResponse = require("../utils/apiResponse");

async function getDashboard(req, res, next) {
  try {
    const dashboard = await billingDashboardService.getBillingDashboard({
      organisationId: getOrganisationId(req),
      userId: req.user?.id,
      role: req.user?.role,
    });

    return res.status(200).json(ApiResponse.success("BILLING_DASHBOARD_LISTED", dashboard));
  } catch (err) {
    next(err);
  }
}

router.use(requireOrganisation);
router.get("/", getDashboard);
router.get("/dashboard", getDashboard);

module.exports = router;
