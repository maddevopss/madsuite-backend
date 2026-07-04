const { pool } = require("../../db"); // Garder pool pour les fonctions qui pourraient s'exécuter hors contexte de requête (ex: jobs)
const logger = require("../config/logger");

const { recordBusinessAudit } = require("./auditLog.service");

/**
 * Suggère des projets pour les activités non assignées.
 * @param {object} dbClient - Le client PostgreSQL configuré pour la RLS.
 * @param {number} organisationId - L'ID de l'organisation.
 * @param {number} utilisateurId
 * @param {string} date - format YYYY-MM-DD
 */
async function getSuggestions(dbClient, organisationId, utilisateurId, date) {
  const query = `
    -- On configure la limite de similarité pour pg_trgm (0.3 est le défaut)
    -- SET LOCAL pg_trgm.similarity_threshold = 0.4;

    WITH combined_activity AS (
      SELECT app_name, window_title, total_seconds
      FROM activity_daily_summary
      WHERE organisation_id = $1 AND utilisateur_id = $2 AND activity_date = $3
      UNION ALL
      SELECT app_name, window_title, SUM(duration_seconds) as total_seconds
      FROM activity_logs
      WHERE organisation_id = $1 AND utilisateur_id = $2 AND is_aggregated = false
        AND captured_at >= $3::timestamp AND captured_at < ($3::timestamp + interval '1 day')
      GROUP BY app_name, window_title
    ),
    aggregated_rows AS (
      SELECT app_name, window_title, SUM(total_seconds) as total_seconds
      FROM combined_activity
      GROUP BY app_name, window_title
      HAVING SUM(total_seconds) > 60
    ),
    cached_matches AS (
      SELECT 
        ar.*,
        apc.suggested_project_id as p_id,
        p.nom as p_nom,
        apc.confidence as score,
        apc.is_manual,
        true as from_cache
      FROM aggregated_rows ar
      LEFT JOIN activity_project_cache apc ON (
        apc.organisation_id = $1 
        AND apc.app_name = ar.app_name 
        AND apc.window_title_hash = md5(ar.window_title)
      )
      LEFT JOIN projets p ON p.id = apc.suggested_project_id
    ),
    scored_matches AS (
      SELECT 
        cm.*,
        p.id as new_p_id,
        p.nom as new_p_nom,
        -- On utilise word_similarity pour être plus tolérant sur les titres longs
        (word_similarity(cm.window_title, p.nom) * 100)::int as new_score,
        ROW_NUMBER() OVER(
          PARTITION BY cm.app_name, cm.window_title 
          ORDER BY (similarity(cm.window_title, p.nom) + similarity(cm.app_name, p.nom)) DESC
        ) as rank
      FROM cached_matches cm
      LEFT JOIN projets p ON (
        cm.p_id IS NULL 
        -- RLS gère l'isolation, mais on aide l'index avec l'organisation_id
        AND p.organisation_id = $1
        AND p.deleted_at IS NULL -- Filtre critique pour les performances
        AND (cm.window_title % p.nom OR cm.app_name % p.nom)
      )
    )
    SELECT 
      app_name, window_title, total_seconds,
      COALESCE(p_id, new_p_id) as suggested_project_id,
      COALESCE(p_nom, new_p_nom) as suggested_project_nom,
      CASE WHEN is_manual THEN 100 ELSE COALESCE(score, new_score) END as confidence,
      is_manual,
      -- On ne demande la mise en cache que si pas déjà présent, un projet est trouvé, 
      -- et que l'activité dépasse 300 secondes (5 minutes)
      (p_id IS NULL AND NOT EXISTS(SELECT 1 FROM activity_project_cache WHERE organisation_id = $1 AND app_name = scored_matches.app_name AND window_title_hash = md5(scored_matches.window_title)) AND new_p_id IS NOT NULL AND total_seconds > 300) as needs_caching
    FROM scored_matches
    WHERE rank = 1
      AND (p_id IS NOT NULL OR new_p_id IS NOT NULL OR score IS NULL) -- On cache si explicitement ignoré (p_id est NULL dans le cache)
    ORDER BY total_seconds DESC
  `;

  try {
    const { rows } = await dbClient.query(query, [organisationId, utilisateurId, date]);

    // Alimentation asynchrone du cache pour les nouveaux résultats significatifs
    const toCache = rows.filter((r) => r.needs_caching);
    if (toCache.length > 0) {
      // On ne bloque pas la réponse pour la mise à jour du cache
      updateCache(dbClient, organisationId, toCache).catch((err) => logger.error("Échec de mise à jour du cache", err));
    }

    return rows.map((row) => ({
      app_name: row.app_name,
      window_title: row.window_title,
      total_seconds: row.total_seconds,
      suggestion: row.suggested_project_id
        ? {
            id: row.suggested_project_id,
            nom: row.suggested_project_nom,
            confidence: row.confidence,
          }
        : null,
    }));
  } catch (err) {
    logger.error("Erreur lors de la génération des suggestions", { error: err.message });
    throw err;
  }
}

/**
 * Convertit une suggestion validée en entrée de temps réelle.
 */
async function applySuggestion(
  dbClient, // Ajout du client DB
  organisationId,
  utilisateurId,
  { projet_id, app_name, window_title, total_seconds, date }, // Destructuration des données de suggestion
  req = null,
) {
  try {
    // Récupération de la config de l'organisation pour le fuseau horaire (utilise le client RLS)
    const orgRes = await dbClient.query("SELECT timezone FROM organisations WHERE id = $1", [organisationId]);
    const tz = orgRes.rows[0]?.timezone || "UTC";

    const projectRes = await dbClient.query(
      "SELECT id FROM projets WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL LIMIT 1",
      [projet_id, organisationId],
    );

    if (projectRes.rowCount === 0) {
      const err = new Error("Projet introuvable pour cette organisation.");
      err.statusCode = 404;
      throw err;
    }

    const description = `[Assistant] ${app_name}: ${window_title}`;
    const startTime = `${date} 09:00:00`; // Idéalement, calculer dynamiquement selon les logs d'activité

    const query = `
      INSERT INTO time_entries (
        organisation_id, utilisateur_id, projet_id, 
        description, start_time, end_time, is_billed
      )
      VALUES ($1, $2, $3, $4, ($5::timestamp AT TIME ZONE $7), (($5::timestamp + ($6 || ' seconds')::interval) AT TIME ZONE $7), false)
      RETURNING id
    `;

    const result = await dbClient.query(query, [
      organisationId,
      utilisateurId,
      projet_id,
      description,
      startTime,
      total_seconds,
      tz,
    ]);

    // APPRENTISSAGE : On enregistre cette validation manuelle dans le cache
    // pour que l'IA ne se trompe plus la prochaine fois.
    await updateCache(dbClient, organisationId, [
      // Passe le client RLS
      {
        app_name,
        window_title,
        suggested_project_id: projet_id,
        confidence: 100,
        is_manual: true,
      },
    ]);

    // Logging d'audit pour la traçabilité métier
    await recordBusinessAudit({
      organisationId,
      actorUserId: utilisateurId,
      action: "billing.suggestion_applied",
      entityType: "time_entry",
      entityId: result.rows[0].id,
      details: { app_name, window_title, duration: total_seconds, date },
      req,
    });

    return result.rows[0];
  } catch (err) {
    logger.error("Erreur lors de l'application de la suggestion", { error: err.message });
    throw err;
  } finally {
    // Le middleware transactionnel s'occupe de la libération du client via ALS
  }
}

/**
 * Marque une signature comme ignorée pour ne plus qu'elle apparaisse dans les suggestions.
 */
async function ignoreSignature(dbClient, organisationId, appName, windowTitle) {
  await updateCache(dbClient, organisationId, [
    // Passe le client RLS
    {
      app_name: appName,
      window_title: windowTitle,
      suggested_project_id: null,
      confidence: 100,
      is_manual: true,
    },
  ]);
}

/**
 * Met à jour le cache de signatures
 */
/**
 * Invalide le cache pour une organisation ou un projet spécifique.
 * Appelé lors de la modification d'un nom de projet pour forcer le recalcul pg_trgm.
 */
async function invalidateCache(dbClient, organisationId, projetId = null) {
  const query = projetId
    ? "DELETE FROM activity_project_cache WHERE organisation_id = $1 AND suggested_project_id = $2 AND is_manual = FALSE"
    : "DELETE FROM activity_project_cache WHERE organisation_id = $1 AND is_manual = FALSE";

  const params = projetId ? [organisationId, projetId] : [organisationId];
  await dbClient.query(query, params);
}

async function updateCache(dbClient, organisationId, suggestions) {
  // Si dbClient est déjà fourni (via un contrôleur RLS), on l'utilise.
  // Sinon (appel hors contexte HTTP, ex: job), on prend une nouvelle connexion.
  const clientToUse = dbClient || (await pool.connect());
  let shouldReleaseClient = !dbClient; // On ne libère que si on a pris une nouvelle connexion

  try {
    if (shouldReleaseClient) {
      // Si on a pris une nouvelle connexion, on doit configurer la RLS manuellement
      await clientToUse.query(`SELECT set_config('app.current_organisation_id', $1, true)`, [organisationId.toString()]);
    }

    const values = [];
    const params = [organisationId];
    suggestions.forEach((s, i) => {
      const base = i * 5 + 2;
      values.push(`($1, $${base}, md5($${base + 1}), $${base + 2}, $${base + 3}, $${base + 4})`);
      params.push(s.app_name, s.window_title, s.suggested_project_id, s.confidence, s.is_manual || false);
    });

    const query = `
      INSERT INTO activity_project_cache (organisation_id, app_name, window_title_hash, suggested_project_id, confidence, is_manual)
      VALUES ${values.join(", ")}
      ON CONFLICT (organisation_id, app_name, window_title_hash) 
      DO UPDATE SET last_used_at = CURRENT_TIMESTAMP, is_manual = EXCLUDED.is_manual OR activity_project_cache.is_manual
    `;

    await clientToUse.query(query, params);
  } finally {
    if (shouldReleaseClient) {
      clientToUse.release();
    }
  }
}

module.exports = {
  getSuggestions,
  applySuggestion,
};
