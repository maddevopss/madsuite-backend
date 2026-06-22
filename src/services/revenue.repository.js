const db = require("../../db");

class RevenueRepository {
  async calculateLiveMetrics(organisationId) {
    const metricsEngine = require("../core/metrics.engine");
    return metricsEngine.computeMetrics(organisationId, { source: 'live_api' });
  }

  async getDashboardMetrics(organisationId) {
    const snapshotQuery = `
      SELECT * FROM metrics_snapshot 
      WHERE organisation_id = $1 AND date = CURRENT_DATE
    `;
    const { rows } = await db.query(snapshotQuery, [organisationId]);

    if (rows.length > 0) {
      const snap = rows[0];
      return {
        revenueDuMois: parseFloat(snap.revenue_month),
        paiementsRecus: parseInt(snap.invoices_paid, 10),
        facturesDues: parseFloat(snap.invoices_due),
        facturesEnRetard: parseFloat(snap.invoices_overdue),
        mrrEstime: parseFloat(snap.mrr),
        recurringCount: parseInt(snap.recurring_count, 10)
      };
    }

    return this.calculateLiveMetrics(organisationId);
  }
}

module.exports = new RevenueRepository();
