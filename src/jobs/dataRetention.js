const cron = require("node-cron");
const logger = require("../config/logger"); // Logger configuré pour le backend
const { recordBusinessAudit } = require("../services/auditLog.service");

/**
 * Exécute une suppression par lots jusqu'à ce que plus rien ne soit supprimé
 * ou que la limite de sécurité soit atteinte.
 */
async function deleteInBatches(client, query, values = [], limit = 5000, maxIter = 20, countColumn = null) {
  let totalDeleted = 0;
  let iterations = 0;
  let lastCount = 0;

  do {
    const res = await client.query(query, values);
    lastCount = countColumn ? Number(res.rows[0][countColumn]) : res.rowCount;
    totalDeleted += lastCount;
    iterations += 1;
  } while (lastCount === limit && iterations < maxIter);

  return totalDeleted;
}

async function tableExists(client, tableName) {
  const res = await client.query("SELECT to_regclass($1) AS regclass", [tableName]);
  return Boolean(res.rows[0]?.regclass);
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

    // activity_logs/activity_daily_summary sont sous RLS FORCE : cette purge
    // en lot traite toutes les organisations sur une connexion non scopée,
    // résolue via des fonctions SECURITY DEFINER dédiées (mêmes requêtes,
    // mêmes bornes de rétention par organisation) plutôt qu'un DELETE direct
    // qui n'affecterait jamais aucune ligne.
    // Note : la colonne organisations.has_extended_retention n'existe dans
    // aucune migration actuelle — l'ancien branchement conditionnel sur
    // cette colonne n'était donc jamais exercé ; les fonctions SQL
    // implémentent uniquement la formule simple réellement en vigueur.

    // 1. Logs d'activité (Loop)
    const logsCount = await deleteInBatches(
      client,
      `SELECT purge_activity_logs_batch($1) AS deleted_count`,
      [BATCH_LIMIT],
      BATCH_LIMIT,
      20,
      "deleted_count",
    );

    // 2. Résumés d'activité (Loop)
    const summaryCount = await deleteInBatches(
      client,
      `SELECT purge_activity_summary_batch($1) AS deleted_count`,
      [BATCH_LIMIT],
      BATCH_LIMIT,
      20,
      "deleted_count",
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
    // time_entries/projets/clients/utilisateurs/invoices sont sous RLS FORCE :
    // résolu via purge_soft_deleted_batch() (nom de table toujours fixe,
    // fourni par l'application, jamais une entrée utilisateur).
    const tablesToCleanup = ["time_entries", "projets", "clients", "utilisateurs", "invoices"];
    let softDeleteCount = 0;

    for (const table of tablesToCleanup) {
      const res = await client.query(`SELECT purge_soft_deleted_batch($1, $2) AS deleted_count`, [table, 5000]);
      softDeleteCount += Number(res.rows[0].deleted_count);
    }

    // Purge des sessions utilisateurs (Hard Delete après 90 jours)
    // user_sessions est sous RLS FORCE.
    const resSessionsCount = await client.query(`SELECT purge_user_sessions_batch($1) AS deleted_count`, [5000]);
    const sessionsDeleted = Number(resSessionsCount.rows[0].deleted_count);

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

    // 6. Purge du buffer d'incidents de sécurité — RLS FORCE.
    let securityIncidentsCount = 0;
    if (await tableExists(client, "security_incidents_buffer")) {
      securityIncidentsCount = await deleteInBatches(
        client,
        `SELECT purge_security_incidents_buffer_batch($1) AS deleted_count`,
        [BATCH_LIMIT],
        BATCH_LIMIT,
        20,
        "deleted_count",
      );
    }

    // Purge du cache de signatures (Billing Assistant) — RLS FORCE.
    // On supprime ce qui n'a pas été utilisé depuis 60 jours
    // OU ce qui est très incertain (< 30%) et pas validé manuellement depuis 7 jours.
    const resCacheCount = await client.query(`SELECT purge_activity_project_cache_batch() AS deleted_count`);
    const cacheDeleted = Number(resCacheCount.rows[0].deleted_count);

    const message = `Purge terminée : ${logsCount} logs, ${summaryCount} résumés, ${auditCount} audits, ${sessionsDeleted} sessions, ${tokensCount} tokens, ${securityIncidentsCount} incidents sécu, ${cacheDeleted} signatures cache et ${softDeleteCount} éléments supprimés définitivement.`;
    logger.info(message);

    // FIX P2 (audit multi-tenant 2026-06-24) :
    // L'ancienne implémentation insérait les statistiques de purge GLOBALES dans les
    // business_audit_logs de TOUTES les organisations, permettant à un admin de voir
    // le volume de données des autres organisations.
    // Correction : on log uniquement dans Winston (logs système), pas dans les audit logs applicatifs.
    logger.info("Purge globale — statistiques système", {
      stats: { logsCount, summaryCount, auditCount, tokensCount, securityIncidentsCount, softDeleteCount },
    });
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
