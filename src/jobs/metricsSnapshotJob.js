const db = require("../../db");
const logger = require("../config/logger");
const metricsEngine = require("../core/metrics.engine");

async function generateMetricsSnapshots() {
  logger.info("Starting metrics snapshot generation");
  
  try {
    const { rows: organisations } = await db.query(
      "SELECT id FROM organisations WHERE deleted_at IS NULL"
    );

    for (const org of organisations) {
      try {
        const metrics = await metricsEngine.computeMetrics(org.id, { source: 'snapshot_job' });
        
        await db.query(`
          INSERT INTO metrics_snapshot (
            organisation_id, 
            date, 
            mrr, 
            revenue_month, 
            invoices_paid, 
            invoices_due, 
            invoices_overdue,
            recurring_count
          ) VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
          ON CONFLICT (organisation_id, date) DO UPDATE SET
            mrr = EXCLUDED.mrr,
            revenue_month = EXCLUDED.revenue_month,
            invoices_paid = EXCLUDED.invoices_paid,
            invoices_due = EXCLUDED.invoices_due,
            invoices_overdue = EXCLUDED.invoices_overdue,
            recurring_count = EXCLUDED.recurring_count,
            created_at = CURRENT_TIMESTAMP
        `, [
          org.id,
          metrics.mrrEstime,
          metrics.revenueDuMois,
          metrics.paiementsRecus,
          metrics.facturesDues,
          metrics.facturesEnRetard,
          metrics.recurringCount
        ]);
      } catch (error) {
        logger.error(`Error generating snapshot for organisation ${org.id}:`, error);
      }
    }
    logger.info("Metrics snapshot generation completed");
  } catch (err) {
    logger.error("Failed to generate metrics snapshots:", err);
  }
}

module.exports = {
  generateMetricsSnapshots
};
