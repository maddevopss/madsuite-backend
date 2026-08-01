const db = require("../../db");
const dbStore = require("../utils/dbStore");
const logger = require("../config/logger");
const metricsEngine = require("../core/metrics.engine");

async function generateMetricsSnapshots() {
  logger.info("Starting metrics snapshot generation");

  try {
    // organisations n'a pas de colonne deleted_at (pas de soft-delete pour les
    // organisations) : le filtre précédent faisait échouer cette requête à
    // chaque exécution, empêchant purement et simplement le job de démarrer.
    const { rows: organisations } = await db.query(
      "SELECT id FROM organisations"
    );

    for (const org of organisations) {
      // invoices/recurring_invoices sont sous RLS FORCE : ce job en lot traite
      // toutes les organisations hors de tout contexte requête — sans ce
      // scoping explicite par organisation, metricsEngine.computeMetrics()
      // ne voit aucune ligne et écrit silencieusement des métriques à zéro
      // pour tout le monde, chaque nuit.
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(org.id)]);

        const metrics = await dbStore.run(
          { dbClient: client, organisationId: org.id },
          () => metricsEngine.computeMetrics(org.id, { source: 'snapshot_job' }),
        );

        await client.query(`
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

        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        logger.error(`Error generating snapshot for organisation ${org.id}:`, error);
      } finally {
        client.release();
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
