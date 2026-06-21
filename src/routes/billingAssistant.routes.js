const express = require("express");
const { z } = require("zod");
const router = express.Router();
const db = require("../../db");
const ApiResponse = require("../utils/apiResponse");
const billingAssistant = require("../services/billingAssistant.service");
const requireRole = require("../middleware/requireRole");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId, organisationValue } = require("../utils/organisationScope");
const { hasColumn } = require("../utils/dbSchema");

function sendRawJson(res, statusCode, payload) {
  return res.status(statusCode).type("json").send(JSON.stringify(payload));
}

function professionalizeDescription(description = "") {
  const clean = String(description || "").trim();

  if (!clean) {
    return "Travail effectué sur le projet selon les besoins du client.";
  }

  return clean
    .replace(/fix/gi, "Correction")
    .replace(/bug/gi, "anomalie")
    .replace(/modal/gi, "fenêtre modale")
    .replace(/test/gi, "validation")
    .replace(/ui/gi, "interface utilisateur")
    .replace(/backend/gi, "serveur applicatif")
    .replace(/frontend/gi, "interface web");
}

const dateSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide. Utilise YYYY-MM-DD."),
});

const applySchema = z.object({
  projet_id: z.coerce.number().int().positive("Le projet est requis."),
  app_name: z.string().trim().max(255).optional().default(""),
  window_title: z.string().trim().max(1000).optional().default(""),
  total_seconds: z.coerce.number().int().positive("La durée doit être supérieure à zéro."),
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide. Utilise YYYY-MM-DD."),
});

router.post(
  "/suggest-description",
  requireOrganisation,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const timeEntryId = Number(req.body?.timeEntryId);

      if (!Number.isInteger(timeEntryId) || timeEntryId <= 0) {
        return sendRawJson(res, 400, { message: "timeEntryId requis." });
      }

      const organisationId = req.organisationId || getOrganisationId(req);
      const params = [timeEntryId];
      const conditions = ["te.id = $1", "te.deleted_at IS NULL"];

      if (await hasColumn("time_entries", "organisation_id")) {
        params.push(organisationValue(organisationId));
        conditions.push(`te.organisation_id = $${params.length}`);
      }

      const entryResult = await db.query(
        `
        SELECT te.*
        FROM time_entries te
        WHERE ${conditions.join(" AND ")}
        LIMIT 1
        `,
        params,
      );

      const entry = entryResult.rows[0];

      if (!entry) {
        return sendRawJson(res, 404, { message: "Entrée de temps introuvable." });
      }

      return sendRawJson(res, 200, {
        time_entry_id: entry.id,
        original_description: entry.description,
        suggested_description: professionalizeDescription(entry.description),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/issues",
  requireOrganisation,
  requireRole("admin"),
  async (req, res, next) => {
    try {
      const organisationId = req.organisationId || getOrganisationId(req);
      const params = [];
      const conditions = [
        "(te.description IS NULL OR TRIM(te.description) = '' OR te.end_time IS NULL)",
        "te.deleted_at IS NULL",
      ];

      if (await hasColumn("time_entries", "organisation_id")) {
        params.push(organisationValue(organisationId));
        conditions.push(`te.organisation_id = $${params.length}`);
      }

      const result = await db.query(
        `
        SELECT te.id, te.utilisateur_id, te.projet_id, te.start_time, te.end_time, te.description
        FROM time_entries te
        WHERE ${conditions.join(" AND ")}
        ORDER BY te.start_time DESC
        LIMIT 20
        `,
        params,
      );

      return sendRawJson(res, 200, result.rows || []);
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        return sendRawJson(res, 200, []);
      }

      next(err);
    }
  },
);

// Récupérer les suggestions pour une date donnée
router.get("/suggestions", requireOrganisation, async (req, res, next) => {
  try {
    const { date } = dateSchema.parse(req.query);
    const data = await billingAssistant.getSuggestions(req.db, req.organisationId, req.user.id, date);
    res.json(data);
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: err.errors }));
    }
    next(err);
  }
});

// Valider une suggestion pour créer une entrée de temps
router.post("/apply", requireOrganisation, async (req, res, next) => {
  try {
    const payload = applySchema.parse(req.body);
    const result = await billingAssistant.applySuggestion(req.db, req.organisationId, req.user.id, payload, req);
    res.status(201).json(result);
  } catch (err) {
    if (err.name === "ZodError") {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: err.errors }));
    }
    next(err);
  }
});

module.exports = router;
