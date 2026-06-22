const revenueRepository = require("./revenue.repository");

class RevenueDashboardService {
  async getDashboardData(organisationId) {
    if (!organisationId) {
      const err = new Error("OrganisationId requis");
      err.statusCode = 403;
      throw err;
    }
    
    return await revenueRepository.getDashboardMetrics(organisationId);
  }
}

module.exports = new RevenueDashboardService();
