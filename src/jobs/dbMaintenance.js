const cron = require("node-cron");
const logger = require("../config/logger");

/**
 * Gère la création automatique des futures partitions pour les tables partitionnées
 */
async function managePartitions(client) {
  const tables = ["activity_logs", "security_incidents_buffer"];

  for (const table of tables) {
    const dateCol = table === "activity_logs" ? "captured_at" : "created_at";

    // Cette requête SQL calcule les dates de début et fin pour le mois prochain et N+2
    // et crée les partitions si elles n'existent pas.
    await client.query(`
      DO $$
      DECLARE
        next_date date;
        partition_name text;
        start_date_val text;
        end_date text;
      BEGIN
        FOR i IN 1..2 LOOP
          next_date := date_trunc('month', current_date + (i || ' month')::interval);
          partition_name := '${table}_y' || to_char(next_date, 'YYYYmMM');
          start_date_val := to_char(next_date, 'YYYY-MM-01');
          end_date := to_char(next_date + interval '1 month', 'YYYY-MM-01');

          IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
            EXECUTE format(
              'CREATE TABLE %I PARTITION OF ${table} FOR VALUES FROM (%L) TO (%L)',
              partition_name, start_date_val, end_date
            );
          END IF;
        END LOOP;
      END $$;
    `);
  }
  logger.info("Vérification/Création des futures partitions terminée.");
}

/**
 * Job de maintenance pour optimiser les performances de la DB
 * - VACUUM ANALYZE : Récupère l'espace mort et met à jour les stats pour l'optimiseur
 * - REINDEX : Reconstruit les index si nécessaire (on utilise CONCURRENTLY pour ne pas bloquer)
 */
async function runDbMaintenance(pool) {
  const client = await pool.connect();
  try {
    logger.info("Démarrage de la maintenance hebdomadaire de la base de données...");

    // Gestion des partitions
    await managePartitions(client);

    // 1. Mise à jour des statistiques pour l'optimiseur de requêtes
    // ANALYZE est léger et crucial pour que les index soient bien choisis.
    await client.query("ANALYZE");
    logger.info("ANALYZE terminé (statistiques mises à jour).");

    // 2. Nettoyage de l'espace mort (Bloat)
    // VACUUM simple ne bloque pas les lectures/écritures.
    await client.query("VACUUM");
    logger.info("VACUUM terminé (espace mort marqué pour réutilisation).");

    // 3. Identification des index volumineux/fragmentés (Optionnel/Logique experte)
    // Pour un MVP, un REINDEX CONCURRENTLY sur les tables de logs une fois par mois suffit.
    // Note: REINDEX CONCURRENTLY nécessite PostgreSQL 12+
    if (new Date().getDate() <= 7) {
      // Une fois par mois (la première semaine)
      logger.info("Reconstruction des index (REINDEX CONCURRENTLY)...");
      await client.query("REINDEX TABLE CONCURRENTLY activity_logs");
      await client.query("REINDEX TABLE CONCURRENTLY activity_daily_summary");
      logger.info("Reindexation terminée.");
    }
  } catch (err) {
    logger.error("Erreur lors de la maintenance DB", { error: err.message });
  } finally {
    client.release();
  }
}

function initMaintenanceJob(pool) {
  // Exécution : Tous les dimanches à 04h00 du matin (période creuse)
  cron.schedule("0 4 * * 0", () => {
    runDbMaintenance(pool);
  });
  logger.info("Job de maintenance DB configuré (hebdomadaire, dimanche 04:00)");
}

module.exports = { initMaintenanceJob, runDbMaintenance };
