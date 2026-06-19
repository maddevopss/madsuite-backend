const express = require("express");
const { z } = require("zod");
const db = require("../../db");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId, getTimezone, organisationValue } = require("../utils/organisationScope");
const ApiResponse = require("../utils/apiResponse");

const router = express.Router();
const updateSummarySchema = z.object({
  summary_text: z.string().trim().min(1).max(10000),
});

function formatHours(seconds = 0) {
  const safeSeconds = Number(seconds) || 0;
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.round((safeSeconds % 3600) / 60);
  return `${h}h${String(m).padStart(2, "0")}`;
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function durationSeconds(startTime, endTime) {
  if (!startTime || !endTime) return 0;
  const diff = new Date(endTime).getTime() - new Date(startTime).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return 0;
  return Math.floor(diff / 1000);
}

function buildOptionalDeletedFilters() {
  return {
    timeEntriesFilter: "AND te.deleted_at IS NULL",
    projectFilter: "AND p.deleted_at IS NULL",
    clientFilter: "AND c.deleted_at IS NULL",
  };
}

router.use(requireOrganisation);

async function getStoredSummary({ userId, organisationId, date }) {
  const result = await db.query(
    `
    SELECT
      id,
      organisation_id,
      utilisateur_id,
      summary_date,
      total_seconds,
      billable_seconds,
      summary_text,
      created_at
    FROM daily_summaries
    WHERE utilisateur_id = $1
      AND organisation_id = $2
      AND summary_date = $3::date
    LIMIT 1
    `,
    [userId, organisationValue(organisationId), date],
  );

  return result.rows[0] || null;
}

router.get("/:date", async (req, res, next) => {
  try {
    const { date } = req.params;

    if (!isValidDate(date)) {
      return res
        .status(400)
        .json(ApiResponse.error("VALIDATION_ERROR", { message: "Date invalide. Format attendu: YYYY-MM-DD." }));
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "Utilisateur non authentifié." }));
    }

    const organisationId = getOrganisationId(req);
    const timezone = await getTimezone(organisationId);
    const { timeEntriesFilter, projectFilter, clientFilter } = buildOptionalDeletedFilters();
    const storedSummary = await getStoredSummary({ userId, organisationId, date }).catch(() => null);

    const entriesResult = await db.query(
      `
      SELECT
        te.id,
        te.projet_id,
        te.utilisateur_id,
        te.start_time,
        te.end_time,
        te.description,
        COALESCE(te.is_billed, false) AS is_billed,
        p.nom AS projet_nom,
        c.nom AS client_nom
      FROM time_entries te
      LEFT JOIN projets p
        ON p.id = te.projet_id
        AND p.organisation_id = $3
        ${projectFilter}
      LEFT JOIN clients c
        ON c.id = p.client_id
        AND c.organisation_id = $3
        ${clientFilter}
      WHERE te.utilisateur_id = $1
        AND te.organisation_id = $3
        AND (te.start_time AT TIME ZONE $4)::date = $2::date
        ${timeEntriesFilter}
      ORDER BY te.start_time ASC
      `,
      [userId, date, organisationValue(organisationId), timezone],
    );

    const entries = entriesResult.rows || [];
    const totalSeconds = entries.reduce((sum, entry) => sum + durationSeconds(entry.start_time, entry.end_time), 0);
    const billableSeconds = entries
      .filter((entry) => entry.is_billed !== false)
      .reduce((sum, entry) => sum + durationSeconds(entry.start_time, entry.end_time), 0);
    const projects = [...new Set(entries.map((entry) => entry.projet_nom).filter(Boolean))];

    const summaryText = `
Résumé du ${date}

Temps total : ${formatHours(totalSeconds)}
Temps potentiellement facturable : ${formatHours(billableSeconds)}

Projets travaillés :
${projects.map((project) => `- ${project}`).join("\n") || "- Aucun projet détecté"}

Activités principales :
${entries.map((entry) => `- ${entry.description || "Entrée sans description"}`).join("\n") || "- Aucune entrée"}
`.trim();

    return res.status(200).json(
      ApiResponse.success("DAY_SUMMARY_GENERATED", {
        summary_date: date,
        utilisateur_id: userId,
        total_seconds: totalSeconds,
        billable_seconds: billableSeconds,
        summary_text: storedSummary?.summary_text || summaryText,
        generated_summary_text: summaryText,
        is_edited: Boolean(storedSummary),
        entries_count: entries.length,
        projects,
      }),
    );
  } catch (err) {
    if (err.code === "42P01" || err.code === "42703") {
      return res.status(200).json(
        ApiResponse.success("DAY_SUMMARY_GENERATED", {
          summary_date: req.params.date,
          utilisateur_id: req.user?.id || null,
          total_seconds: 0,
          billable_seconds: 0,
          summary_text: `Résumé du ${req.params.date}\n\nAucune donnée disponible pour le moment.`,
          entries_count: 0,
          projects: [],
        }),
      );
    }

    return next(err);
  }
});

router.put("/:date", async (req, res, next) => {
  try {
    const { date } = req.params;

    if (!isValidDate(date)) {
      return res
        .status(400)
        .json(ApiResponse.error("VALIDATION_ERROR", { message: "Date invalide. Format attendu: YYYY-MM-DD." }));
    }

    const parsed = updateSummarySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json(
        ApiResponse.error("VALIDATION_ERROR", {
          message: "Resume invalide",
          errors: parsed.error.flatten(),
        }),
      );
    }

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json(ApiResponse.error("UNAUTHORIZED", { message: "Utilisateur non authentifie." }));
    }

    const organisationId = getOrganisationId(req);
    const result = await db.query(
      `
      INSERT INTO daily_summaries
        (organisation_id, utilisateur_id, summary_date, summary_text)
      VALUES
        ($1, $2, $3::date, $4)
      ON CONFLICT (organisation_id, utilisateur_id, summary_date)
      DO UPDATE SET summary_text = EXCLUDED.summary_text
      RETURNING
        id,
        organisation_id,
        utilisateur_id,
        summary_date,
        total_seconds,
        billable_seconds,
        summary_text,
        created_at
      `,
      [organisationValue(organisationId), userId, date, parsed.data.summary_text],
    );

    return res.status(200).json(
      ApiResponse.success("DAY_SUMMARY_UPDATED", {
        ...result.rows[0],
        is_edited: true,
      }),
    );
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
