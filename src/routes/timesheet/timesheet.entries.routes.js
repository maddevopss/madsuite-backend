const express = require("express");
const { z } = require("zod");

const { getOrganisationId } = require("../../utils/organisationScope");
const { handleServiceError } = require("../../utils/routeError");
const { idParamSchema } = require("../../validators/common.validator");
const timesheetService = require("../../services/timesheet/timesheet.service");
const ApiResponse = require("../../utils/apiResponse");

const router = express.Router();

const entriesQuerySchema = z.object({
  date_debut: z.string().optional(),
  date_fin: z.string().optional(),
  client_id: z.coerce.number().int().positive().optional(),
  is_billed: z.enum(["true", "false", ""]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  page: z.coerce.number().int().min(1).optional().default(1),
  utilisateur_id: z.coerce.number().int().positive().optional(),
});

const manualEntrySchema = z.object({
  projet_id: z.coerce.number().int().positive(),
  description: z.string().max(2000).optional().nullable(),
  start_time: z.string(),
  end_time: z.string(),
});

const updateEntrySchema = z.object({
  projet_id: z.coerce.number().int().positive().optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  start_time: z.string().optional().nullable(),
  end_time: z.string().optional().nullable(),
});

const billedSchema = z.object({
  is_billed: z.boolean(),
});

const statusSchema = z.object({
  status: z.enum(["draft", "submitted", "approved", "rejected"]),
});

function parseEntryId(req, res) {
  const params = idParamSchema.safeParse(req.params);

  if (!params.success) {
    res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    return null;
  }

  return params.data.id;
}

router.get("/entries", async (req, res, next) => {
  try {
    const parsed = entriesQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Paramètres invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const result = await timesheetService.listEntries({
      userId: req.user.id,
      role: req.user?.role,
      organisationId: getOrganisationId(req),
      dateDebut: parsed.data.date_debut,
      dateFin: parsed.data.date_fin,
      clientId: parsed.data.client_id,
      isBilled: parsed.data.is_billed,
      limit: parsed.data.limit,
      page: parsed.data.page,
      filterUserId: parsed.data.utilisateur_id,
    });

    return res.status(200).json(ApiResponse.success("TIMESHEET_ENTRIES_LISTED", result));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/manual", async (req, res, next) => {
  try {
    const parsed = manualEntrySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const entry = await timesheetService.createManualEntry({
      userId: req.user.id,
      organisationId: getOrganisationId(req),
      projetId: parsed.data.projet_id,
      description: parsed.data.description || null,
      startTime: parsed.data.start_time,
      endTime: parsed.data.end_time,
    });

    return res.status(201).json(ApiResponse.success("TIMESHEET_ENTRY_CREATED", entry));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.patch("/entries/:id", async (req, res, next) => {
  try {
    const entryId = parseEntryId(req, res);
    if (!entryId) return;

    const parsed = updateEntrySchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const entry = await timesheetService.updateEntry({
      entryId,
      userId: req.user.id,
      role: req.user?.role,
      organisationId: getOrganisationId(req),
      projetId: parsed.data.projet_id,
      description: parsed.data.description,
      startTime: parsed.data.start_time,
      endTime: parsed.data.end_time,
    });

    return res.status(200).json(ApiResponse.success("TIMESHEET_ENTRY_UPDATED", entry));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.patch("/entries/:id/facturer", async (req, res, next) => {
  try {
    const entryId = parseEntryId(req, res);
    if (!entryId) return;

    const parsed = billedSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const entry = await timesheetService.setEntryBilled({
      entryId,
      userId: req.user.id,
      role: req.user?.role,
      organisationId: getOrganisationId(req),
      isBilled: parsed.data.is_billed,
    });

    return res.status(200).json(ApiResponse.success("TIMESHEET_ENTRY_BILLED_UPDATED", entry));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.patch("/entries/:id/status", async (req, res, next) => {
  try {
    const entryId = parseEntryId(req, res);
    if (!entryId) return;

    const parsed = statusSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Statut invalide",
        errors: parsed.error.flatten(),
      }));
    }

    const entry = await timesheetService.setEntryStatus({
      entryId,
      userId: req.user.id,
      role: req.user?.role,
      organisationId: getOrganisationId(req),
      status: parsed.data.status,
    });

    return res.status(200).json(ApiResponse.success("TIMESHEET_ENTRY_STATUS_UPDATED", entry));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.delete("/entries/:id", async (req, res, next) => {
  try {
    const entryId = parseEntryId(req, res);
    if (!entryId) return;

    const deleted = await timesheetService.deleteEntry({
      entryId,
      userId: req.user.id,
      role: req.user?.role,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json({
      success: true,
      deletedId: deleted.id,
    });
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
