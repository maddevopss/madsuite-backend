const revenueDashboardService = require("../services/revenueDashboard.service");
const ApiResponse = require("../utils/apiResponse");

class RevenueController {
  async getDashboard(req, res, next) {
    try {
      const data = await revenueDashboardService.getDashboardData(req.organisationId);
      return res.status(200).json(ApiResponse.success("REVENUE_DASHBOARD_FETCHED", data));
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RevenueController();
