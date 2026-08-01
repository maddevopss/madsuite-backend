const express = require("express");
const { z } = require("zod");

const ApiResponse = require("../utils/apiResponse");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const { requireOrganisation } = require("../middleware/organization.middleware");
const reminderService = require("../services/payment-reminder.service");
const reminderPreviewService = require("../services/payment-reminder-preview.service");

const router = express.Router();
// getSettings/updateSettings/listCandidates/listHistory lisent des tables
// sous RLS FORCE via db.query() direct : sans ce middleware, ces requêtes
// retournent toujours vide (settings jamais lues/écrites, historique et
// candidats toujours vides).
router.use(requireOrganisation);

const invoiceParamSchema = z.object({ id: z.coerce.number().int().positive() });
const settingsSchema = z.object({ automatic_enabled: z.boolean() });
const stageSchema = z.coerce.number().int().refine((value) => [3, 7, 14].includes(value));
const sendSchema = z.object({ stage: stageSchema });

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

router.get("/settings", async (req, res, next) => {
  try {
    const settings = await reminderService.getSettings(getOrganisationId(req));
    return res.status(200).json(ApiResponse.success("PAYMENT_REMINDER_SETTINGS", settings));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.put("/settings", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: parsed.error.flatten() }));
    }
    const settings = await reminderService.updateSettings({
      organisationId: getOrganisationId(req),
      automaticEnabled: parsed.data.automatic_enabled,
      updatedBy: req.user?.id,
    });
    return res.status(200).json(ApiResponse.success("PAYMENT_REMINDER_SETTINGS_UPDATED", settings));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.get("/candidates", async (req, res, next) => {
  try {
    const candidates = await reminderService.listCandidates(getOrganisationId(req));
    return res.status(200).json(ApiResponse.success("PAYMENT_REMINDER_CANDIDATES", candidates));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.get("/history", async (req, res, next) => {
  try {
    const invoiceId = req.query.invoice_id ? Number(req.query.invoice_id) : undefined;
    if (req.query.invoice_id && (!Number.isInteger(invoiceId) || invoiceId < 1)) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "Facture invalide" }));
    }
    const history = await reminderService.listHistory({
      organisationId: getOrganisationId(req),
      invoiceId,
    });
    return res.status(200).json(ApiResponse.success("PAYMENT_REMINDER_HISTORY", history));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.get("/invoices/:id/preview", async (req, res, next) => {
  try {
    const params = invoiceParamSchema.safeParse(req.params);
    const stage = stageSchema.safeParse(req.query.stage);
    if (!params.success || !stage.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        errors: { params: params.error?.flatten(), stage: stage.error?.flatten() },
      }));
    }

    const preview = await reminderPreviewService.previewReminder({
      invoiceId: params.data.id,
      organisationId: getOrganisationId(req),
      stage: stage.data,
    });
    if (!preview) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable" }));
    }
    return res.status(200).json(ApiResponse.success("PAYMENT_REMINDER_PREVIEW", preview));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/invoices/:id/send", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const params = invoiceParamSchema.safeParse(req.params);
    const body = sendSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        errors: { params: params.error?.flatten(), body: body.error?.flatten() },
      }));
    }

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const result = await reminderService.sendReminder({
      invoiceId: params.data.id,
      organisationId: getOrganisationId(req),
      stage: body.data.stage,
      mode: "manual",
      requestedBy: req.user?.id,
      baseUrl,
      req,
    });

    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable" }));
    }
    return res.status(result.duplicate ? 200 : 202).json(ApiResponse.success(
      result.duplicate ? "PAYMENT_REMINDER_ALREADY_QUEUED" : "PAYMENT_REMINDER_QUEUED",
      result,
    ));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

module.exports = router;
