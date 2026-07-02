const db = require("../../db");

const { organisationValue, getTimezone } = require("../utils/organisationScope");

const DEFAULT_LONG_TIMER_THRESHOLD_HOURS = 8;

/**
 * Returns the configured long-running timer threshold in hours.
 *
 * The value is read at call time so tests and deployments can override
 * LONG_TIMER_THRESHOLD_HOURS without restarting module state.
 *
 * @returns {number}
 */
function getLongTimerThresholdHours() {
  const value = Number(process.env.LONG_TIMER_THRESHOLD_HOURS);

  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_LONG_TIMER_THRESHOLD_HOURS;
  }

  return value;
}

/**
 * Adds duration and long-running metadata to an active timer row.
 *
 * @param {object|null} timer Active time_entries row enriched with project/client data.
 * @returns {object|null}
 */
function enrichTimerWithDuration(timer) {
  if (!timer) return null;

  const startTime = new Date(timer.start_time).getTime();
  const now = Date.now();

  const durationSeconds = Math.max(0, Math.floor((now - startTime) / 1000));
  const thresholdHours = getLongTimerThresholdHours();
  const thresholdSeconds = thresholdHours * 3600;

  return {
    ...timer,
    duration_seconds: durationSeconds,
    long_timer_threshold_hours: thresholdHours,
    is_long_running: durationSeconds >= thresholdSeconds,
    warning:
      durationSeconds >= thresholdSeconds
        ? `Timer en cours depuis plus de ${thresholdHours} heures. Vérifie si tu l'as oublié.`
        : null,
  };
}

function requireOrganisation(organisationId) {
  if (!organisationId) {
    const err = new Error("Aucune organisation associée à cet utilisateur.");
    err.statusCode = 403;
    throw err;
  }
}

function getOptionalFilters() {
  return {
    projectFilter: "AND p.deleted_at IS NULL",
    clientFilter: "AND c.deleted_at IS NULL",
  };
}

/**
 * Fetches the current open timer for a user in one organisation.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.organisationId
 * @returns {Promise<object|null>}
 */
async function getActiveTimer({ userId, organisationId }) {
  requireOrganisation(organisationId);

  const { projectFilter, clientFilter } = await getOptionalFilters();

  const result = await db.query(
    `
    SELECT
      te.*,
      p.nom AS projet_nom,
      p.couleur AS projet_couleur,
      c.nom AS client_nom
    FROM time_entries te
    JOIN projets p
      ON p.id = te.projet_id
      AND p.organisation_id = $2
      ${projectFilter}
    JOIN clients c
      ON c.id = p.client_id
      AND c.organisation_id = $2
      ${clientFilter}
    WHERE te.utilisateur_id = $1
      AND te.organisation_id = $2
      AND te.end_time IS NULL
    ORDER BY te.start_time DESC
    LIMIT 1
    `,
    [userId, organisationValue(organisationId)],
  );

  return enrichTimerWithDuration(result.rows[0] || null);
}

async function stopOpenTimers({ userId, organisationId }) {
  const result = await db.query(
    `
    UPDATE time_entries
    SET end_time = NOW()
    WHERE utilisateur_id = $1
      AND organisation_id = $2
      AND end_time IS NULL
    RETURNING *
    `,
    [userId, organisationValue(organisationId)],
  );

  return result.rows;
}

/**
 * Starts a timer and closes any other open timer for the same user.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.organisationId
 * @param {number} params.projetId
 * @param {string|null} [params.description]
 * @returns {Promise<object>}
 */
async function startTimer({ userId, organisationId, projetId, description = null }) {
  requireOrganisation(organisationId);

  const { projectFilter, clientFilter } = await getOptionalFilters();

  try {
    const project = await db.query(
      `
      SELECT p.id
      FROM projets p
      JOIN clients c
        ON c.id = p.client_id
        AND c.organisation_id = $2
        ${clientFilter}
      WHERE p.id = $1
        AND p.organisation_id = $2
        AND p.status = 'actif'
        ${projectFilter}
      FOR SHARE OF p, c
      `,
      [projetId, organisationValue(organisationId)],
    );

    if (project.rowCount === 0) {
      const err = new Error("Projet introuvable ou non accessible.");
      err.statusCode = 404;
      throw err;
    }

    await stopOpenTimers({
      userId,
      organisationId,
    });

    const result = await db.query(
      `
      INSERT INTO time_entries
        (
          projet_id,
          utilisateur_id,
          start_time,
          description,
          hourly_rate_used,
          organisation_id
        )
      SELECT
        p.id,
        $2,
        NOW(),
        $3,
        COALESCE(p.taux_horaire, c.hourly_rate_defaut, 0),
        $4
      FROM projets p
      JOIN clients c
        ON c.id = p.client_id
        AND c.organisation_id = $4
        ${clientFilter}
      WHERE p.id = $1
        AND p.organisation_id = $4
        AND p.status = 'actif'
        ${projectFilter}
      RETURNING *
      `,
      [projetId, userId, description, organisationValue(organisationId)],
    );

    if (result.rows.length === 0) {
      const err = new Error("Projet introuvable ou non accessible.");
      err.statusCode = 404;
      throw err;
    }

    return result.rows[0];
  } catch (err) {
    throw err;
  }
}

/**
 * Starts an unsorted timer by finding or creating a default "À classer" project.
 */
async function startUnsortedTimer({ userId, organisationId, description = null }) {
  requireOrganisation(organisationId);

  // 1. Find or create default client "Interne"
  let clientRes = await db.query(
    `SELECT id FROM clients WHERE nom = 'Interne' AND organisation_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [organisationValue(organisationId)]
  );
  
  let clientId;
  if (clientRes.rows.length === 0) {
    const newClient = await db.query(
      `INSERT INTO clients (nom, organisation_id) VALUES ('Interne', $1) RETURNING id`,
      [organisationValue(organisationId)]
    );
    clientId = newClient.rows[0].id;
  } else {
    clientId = clientRes.rows[0].id;
  }

  // 2. Find or create default project "À classer"
  let projetRes = await db.query(
    `SELECT id FROM projets WHERE nom = 'À classer' AND client_id = $1 AND organisation_id = $2 AND deleted_at IS NULL LIMIT 1`,
    [clientId, organisationValue(organisationId)]
  );

  let projetId;
  if (projetRes.rows.length === 0) {
    const newProjet = await db.query(
      `INSERT INTO projets (client_id, nom, couleur, organisation_id) VALUES ($1, 'À classer', '#808080', $2) RETURNING id`,
      [clientId, organisationValue(organisationId)]
    );
    projetId = newProjet.rows[0].id;
  } else {
    projetId = projetRes.rows[0].id;
  }

  // 3. Start timer
  return startTimer({ userId, organisationId, projetId, description });
}

/**
 * Stops the current open timer for a user.
 *
 * @param {object} params
 * @param {number} params.userId
 * @param {number} params.organisationId
 * @returns {Promise<object|null>}
 */
async function stopTimer({ userId, organisationId }) {
  requireOrganisation(organisationId);
  // Plus besoin de BEGIN/COMMIT, transactionMiddleware s'en occupe
  const stoppedTimers = await stopOpenTimers({
    userId,
    organisationId,
  });
  return stoppedTimers[0] || null;
}

async function getTodayProjects({ userId, organisationId }) {
  requireOrganisation(organisationId);

  const timezone = await getTimezone(organisationId);
  const { projectFilter, clientFilter } = await getOptionalFilters();

  const result = await db.query(
    `
    SELECT DISTINCT ON (te.projet_id)
      te.projet_id,
      te.description,
      te.start_time,
      te.end_time,
      p.nom AS projet_nom,
      p.client_id,
      p.couleur AS projet_couleur,
      c.nom AS client_nom
    FROM time_entries te
    JOIN projets p
      ON p.id = te.projet_id
      AND p.organisation_id = $2
      ${projectFilter}
    JOIN clients c
      ON c.id = p.client_id
      AND c.organisation_id = $2
      ${clientFilter}
    WHERE te.utilisateur_id = $1
      AND te.organisation_id = $2
      AND (te.start_time AT TIME ZONE $3)::date = (NOW() AT TIME ZONE $3)::date
    ORDER BY te.projet_id, te.start_time DESC
    `,
    [userId, organisationValue(organisationId), timezone],
  );

  return result.rows;
}

async function updateActiveTimerNote({ userId, organisationId, note }) {
  // ═══════════════════════════════════════════════════════════════
  // SINGLE SOURCE OF TRUTH — timer notes
  // ONLY PATCH /api/timer/active/note may call this function.
  // Activity routes, event processors, etc. MUST NOT mutate timer state.
  // If you are here from /activity/* → this is an architectural violation.
  // ═══════════════════════════════════════════════════════════════
  requireOrganisation(organisationId);

  if (typeof note !== "string") {
    const err = new Error("note doit être une chaîne");
    err.statusCode = 400;
    throw err;
  }

  const result = await db.query(
    `
    UPDATE time_entries
    SET note = $1,
        updated_at = CURRENT_TIMESTAMP
    WHERE utilisateur_id = $2
      AND organisation_id = $3
      AND end_time IS NULL
    RETURNING id, note, updated_at
    `,
    [note, userId, organisationValue(organisationId)],
  );

  if (result.rowCount === 0) {
    const err = new Error("Aucun timer actif");
    err.statusCode = 404;
    throw err;
  }

  return result.rows[0];
}

module.exports = {
  getLongTimerThresholdHours,
  getActiveTimer,
  startTimer,
  startUnsortedTimer,
  stopTimer,
  getTodayProjects,
  updateActiveTimerNote,
};
