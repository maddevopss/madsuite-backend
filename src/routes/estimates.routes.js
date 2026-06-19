const express = require("express");
const { z } = require("zod");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const estimateService = require("../services/estimate.service");
const { recordBusinessAudit } = require("../services/auditLog.service");

const router = express.Router();

router.use(requireOrganisation);

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");

const estimateItemSchema = z.object({
  description: z.string().min(1).max(1000),
  quantity: z.coerce.number().min(0),
  unit_rate: z.coerce.number().min(0),
});

const createEstimateSchema = z.object({
  client_id: z.coerce.number().int().positive(),
  items: z.array(estimateItemSchema).min(1),
  tax_rate: z.coerce.number().min(0).max(100).optional().default(0),
  notes: z.string().max(5000).optional().nullable(),
  issue_date: dateStringSchema.optional(),
  valid_until: dateStringSchema.optional(),
});

const updateEstimateSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "rejected", "invoiced"]).optional(),
  issue_date: dateStringSchema.optional().nullable(),
  valid_until: dateStringSchema.optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const listEstimatesQuerySchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "rejected", "invoiced"]).optional(),
  client_id: z.coerce.number().int().positive().optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function parseEstimateId(req, res) {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    return null;
  }
  return parsed.data.id;
}

function assertEstimateMutationRole(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

router.get("/", async (req, res, next) => {
  try {
    const parsed = listEstimatesQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Parametres invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const estimates = await estimateService.listEstimates({
      organisationId: getOrganisationId(req),
      status: parsed.data.status,
      clientId: parsed.data.client_id,
    });

    return res.status(200).json(ApiResponse.success("ESTIMATE_LISTED", estimates));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (!assertEstimateMutationRole(req, res)) return;

    const parsed = createEstimateSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const estimate = await estimateService.createEstimate({
      clientId: parsed.data.client_id,
      items: parsed.data.items,
      issueDate: parsed.data.issue_date,
      validUntil: parsed.data.valid_until,
      notes: parsed.data.notes,
      taxRate: parsed.data.tax_rate,
      organisationId: getOrganisationId(req)
    });

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "estimate.created",
      entityType: "estimate",
      entityId: estimate.id,
      details: {
        clientId: parsed.data.client_id,
        itemCount: parsed.data.items.length,
      },
      req,
    });

    return res.status(201).json(ApiResponse.success("ESTIMATE_CREATED", estimate));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const estimateId = parseEstimateId(req, res);
    if (!estimateId) return;

    const estimate = await estimateService.getEstimateById(
      estimateId,
      getOrganisationId(req)
    );

    if (!estimate) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Soumission introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("ESTIMATE_RETRIEVED", estimate));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (!assertEstimateMutationRole(req, res)) return;

    const estimateId = parseEstimateId(req, res);
    if (!estimateId) return;

    const parsed = updateEstimateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const estimate = await estimateService.updateEstimate(
      estimateId,
      getOrganisationId(req),
      parsed.data
    );

    if (!estimate) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Soumission introuvable." }));
    }

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "estimate.updated",
      entityType: "estimate",
      entityId: estimate.id,
      details: {
        status: parsed.data.status ?? null,
      },
      req,
    });

    return res.status(200).json(ApiResponse.success("ESTIMATE_UPDATED", estimate));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!assertEstimateMutationRole(req, res)) return;

    const estimateId = parseEstimateId(req, res);
    if (!estimateId) return;

    const deleted = await estimateService.deleteEstimate({
      estimateId,
      organisationId: getOrganisationId(req),
    });

    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Soumission introuvable." }));
    }

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "estimate.deleted",
      entityType: "estimate",
      entityId: deleted.id,
      details: {},
      req,
    });

    return res.status(200).json(ApiResponse.success("ESTIMATE_DELETED", {
      deletedId: deleted.id,
    }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/:id/convert", async (req, res, next) => {
  try {
    if (!assertEstimateMutationRole(req, res)) return;

    const estimateId = parseEstimateId(req, res);
    if (!estimateId) return;

    const invoice = await estimateService.convertToInvoice({
      estimateId,
      organisationId: getOrganisationId(req),
      billedBy: req.user?.id ?? null,
    });

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "estimate.converted",
      entityType: "estimate",
      entityId: estimateId,
      details: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
      },
      req,
    });

    return res.status(201).json(ApiResponse.success("ESTIMATE_CONVERTED", invoice));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const estimateId = parseEstimateId(req, res);
    if (!estimateId) return;

    const pdfData = await estimateService.generateEstimatePdf({
      estimateId,
      organisationId: getOrganisationId(req),
    });

    if (!pdfData) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Soumission introuvable." }));
    }

    const filename = `soumission_${pdfData.estimate.estimate_number}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(pdfData.buffer);
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
