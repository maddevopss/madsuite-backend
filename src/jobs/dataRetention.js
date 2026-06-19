const cron = require("node-cron");
const logger = require("../config/logger"); // Logger configuré pour le backend
const { recordBusinessAudit } = require("../services/auditLog.service");

/**
 * Exécute une suppression par lots jusqu'à ce que plus rien ne soit supprimé
 * ou que la limite de sécurité soit atteinte.
 */
async function deleteInBatches(client, query, values = [], limit = 5000, maxIter = 20) {
  let totalDeleted = 0;
  let iterations = 0;
  let lastCount = 0;

  do {
    const res = await client.query(query, values);
    lastCount = res.rowCount;
    totalDeleted += lastCount;
    iterations += 1;
  } while (lastCount === limit && iterations < maxIter);

  return totalDeleted;
}

async function tableExists(client, tableName) {
  const res = await client.query("SELECT to_regclass($1) AS regclass", [tableName]);
  return Boolean(res.rows[0]?.regclass);
}

async function columnExists(client, tableName, columnName) {
  const res = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = $1
      AND column_name = $2
    LIMIT 1
    `,
    [tableName, columnName],
  );

  return res.rowCount > 0;
}

/**
 * Supprime physiquement les partitions dont la date de fin est dépassée
 * par rapport à la rétention maximale du système (sobriété I/O).
 */
async function dropExpiredPartitions(client, tableName, maxRetentionDays = 120) {
  const pivotDate = new Date();
  pivotDate.setDate(pivotDate.getDate() - maxRetentionDays);
  const pivotStr = pivotDate.toISOString().split("T")[0];

  // On cherche les partitions dont le range de fin (FOR VALUES TO) est inférieur à notre pivot
  const query = `
    SELECT
      child.relname AS partition_name
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child  ON pg_inherits.inhrelid  = child.oid
    WHERE parent.relname = $1
    AND pg_get_expr(child.relpartbound, child.oid) ~ 'TO \\(''%L''\\)' -- Regex simple pour extraire la date de fin
    AND (pg_get_expr(child.relpartbound, child.oid)::text COLLATE "C") < ('FOR VALUES FROM (min) TO (''' || $2 || ''')')
  `;

  // Note: La manipulation dynamique de partitions est complexe en SQL pur via regex.
  // Pour MADSuite, on va utiliser une approche par nommage (plus robuste et sobre).
  const res = await client.query(
    `
    SELECT relname as name 
    FROM pg_class 
    WHERE relname LIKE $1 || '_y%m%' 
    AND relname < $1 || '_y' || to_char($2::date, 'YYYY"m"MM')
  `,
    [tableName, pivotStr],
  );

  for (const row of res.rows) {
    logger.info(`DROP PARTITION : Suppression de la partition obsolète ${row.name}`);
    await client.query(`DROP TABLE IF EXISTS ${row.name}`);
  }
}

async function runDataPurge(pool) {
  const client = await pool.connect();
  const PURGE_LOCK_ID = parseInt(process.env.PURGE_LOCK_ID) || 86400;
  const BATCH_LIMIT = parseInt(process.env.PURGE_BATCH_LIMIT) || 5000;
  let lockAcquired = false;

  try {
    logger.info("Démarrage de la purge automatique des données par organisation...");

    const lock = await client.query("SELECT pg_try_advisory_lock($1)", [PURGE_LOCK_ID]);
    if (!lock.rows[0].pg_try_advisory_lock) {
      logger.warn("Un autre job de purge est déjà en cours. Abandon.");
      return;
    }
    lockAcquired = true;

    // --- NOUVEAU : Purge par DROP PARTITION (System Safety Net) ---
    // On dégage tout ce qui a plus de 120 jours, peu importe l'organisation.
    await dropExpiredPartitions(client, "activity_logs", 120);
    if (await tableExists(client, "security_incidents_buffer")) {
      await dropExpiredPartitions(client, "security_incidents_buffer", 120);
    }

    const hasExtendedRetentionColumn = await columnExists(client, "organisations", "has_extended_retention");
    const activityLogsRetentionExpr = hasExtendedRetentionColumn
      ? `(CASE WHEN o.has_extended_retention = TRUE THEN o.retention_activity_logs_days ELSE LEAST(o.retention_activity_logs_days, 30) END * INTERVAL '1 day')`
      : `(o.retention_activity_logs_days * INTERVAL '1 day')`;
    const summaryRetentionExpr = hasExtendedRetentionColumn
      ? `(CASE WHEN o.has_extended_retention = TRUE THEN o.retention_summary_days ELSE LEAST(o.retention_summary_days, 30) END * INTERVAL '1 day')`
      : `(o.retention_summary_days * INTERVAL '1 day')`;

    // Utilisation d'un join pour appliquer les délais spécifiques à chaque organisation.
    // On utilise les colonnes ajoutées via la migration 015.

    // 1. Logs d'activité (Loop)
    const logsCount = await deleteInBatches(
      client,
      `
      DELETE FROM activity_logs
      WHERE id IN (
        SELECT al.id FROM activity_logs al
        JOIN organisations o ON al.organisation_id = o.id
        WHERE al.captured_at < NOW() - ${activityLogsRetentionExpr}
          AND al.is_aggregated = true
        LIMIT $1
      )
    `,
      [BATCH_LIMIT],
      BATCH_LIMIT,
    );

    // 2. Résumés d'activité (Loop)
    const summaryCount = await deleteInBatches(
      client,
      `
      DELETE FROM activity_daily_summary
      WHERE id IN (
        SELECT ads.id FROM activity_daily_summary ads
        JOIN organisations o ON ads.organisation_id = o.id
        WHERE ads.activity_date < CURRENT_DATE - ${summaryRetentionExpr}
        LIMIT $1
      )
    `,
      [BATCH_LIMIT],
      BATCH_LIMIT,
    );

    // 3. Audits métier (Loop)
    const auditCount = await deleteInBatches(
      client,
      `
      DELETE FROM business_audit_logs
      WHERE id IN (
        SELECT bal.id FROM business_audit_logs bal
        JOIN organisations o ON bal.organisation_id = o.id
        WHERE bal.created_at < NOW() - (o.retention_audit_logs_days * INTERVAL '1 day')
        LIMIT $1
      )
    `,
      [BATCH_LIMIT],
      BATCH_LIMIT,
    );

    // Purge des données "soft-deleted" depuis plus de 90 jours
    const tablesToCleanup = ["time_entries", "projets", "clients", "utilisateurs", "invoices"];
    let softDeleteCount = 0;

    for (const table of tablesToCleanup) {
      const res = await client.query(`
        DELETE FROM ${table}
        WHERE id IN (SELECT id FROM ${table} WHERE deleted_at < NOW() - INTERVAL '90 days' LIMIT 5000)
      `);
      softDeleteCount += res.rowCount;
    }

    // Purge des sessions utilisateurs (Hard Delete après 90 jours)
    const resSessions = await client.query(`
      DELETE FROM user_sessions
      WHERE id IN (SELECT id FROM user_sessions WHERE login_time < NOW() - INTERVAL '90 days' LIMIT 5000)
    `);

    // Purge des Refresh Tokens expirés ou révoqués
    const tokensCount = await deleteInBatches(
      client,
      `
      DELETE FROM refresh_tokens
      WHERE id IN (
        SELECT id FROM refresh_tokens 
        WHERE expires_at < NOW() OR revoked_at IS NOT NULL 
        LIMIT $1
      )
      `,
      [BATCH_LIMIT],
      BATCH_LIMIT,
    );

    // 6. Purge du buffer d'incidents de sécurité
    let securityIncidentsCount = 0;
    if (await tableExists(client, "security_incidents_buffer")) {
      securityIncidentsCount = await deleteInBatches(
        client,
        `
        DELETE FROM security_incidents_buffer
        WHERE id IN (
          SELECT id FROM security_incidents_buffer 
          WHERE (notified_at < NOW() - INTERVAL '30 days')
             OR (created_at < NOW() - INTERVAL '90 days')
          LIMIT $1
        )
        `,
        [BATCH_LIMIT],
        BATCH_LIMIT,
      );
    }

    // Purge du cache de signatures (Billing Assistant)
    // On supprime ce qui n'a pas été utilisé depuis 60 jours
    // OU ce qui est très incertain (< 30%) et pas validé manuellement depuis 7 jours.
    const resCache = await client.query(`
      DELETE FROM activity_project_cache
      WHERE last_used_at < NOW() - INTERVAL '60 days'
         OR (confidence < 30 AND is_manual = FALSE AND last_used_at < NOW() - INTERVAL '7 days')
    `);

    const message = `Purge terminée : ${logsCount} logs, ${summaryCount} résumés, ${auditCount} audits, ${resSessions.rowCount} sessions, ${tokensCount} tokens, ${securityIncidentsCount} incidents sécu, ${resCache.rowCount} signatures cache et ${softDeleteCount} éléments supprimés définitivement.`;
    logger.info(message);

    // Injection massive en une seule requête pour économiser les tokens/ressources
    await client.query(
      `
      INSERT INTO business_audit_logs 
        (organisation_id, action, entity_type, entity_id, details, created_at)
      SELECT 
        id, 
        'system.purge_executed', 
        'system', 
        0, 
        $1::jsonb, 
        NOW()
      FROM organisations
    `,
      [
        JSON.stringify({
          message,
          stats: { logsCount, summaryCount, auditCount, tokensCount, securityIncidentsCount, softDeleteCount },
        }),
      ],
    );
  } catch (err) {
    logger.error(`Erreur lors de la purge des données (dataRetention job): ${err?.message || err}`, {
      error: err?.message,
      code: err?.code,
    });
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [PURGE_LOCK_ID]);
    }
    client.release();
  }
}

/**
 * Initialise le job de rétention de données
 */
function initRetentionJob(pool) {
  // Planification : Tous les jours à 03h00 du matin
  cron.schedule("0 3 * * *", () => {
    runDataPurge(pool);
  });
  logger.info("Job de rétention de données configuré (exécution quotidienne à 03:00)");
}

module.exports = { initRetentionJob, runDataPurge };
