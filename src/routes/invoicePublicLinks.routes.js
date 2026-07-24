const express = require("express");
const { z } = require("zod");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const publicLinkService = require("../services/invoice/invoice-public-link.service");

const router = express.Router();
router.use(requireOrganisation);

const idSchema = z.coerce.number().int().positive();
const createLinkSchema = z.object({
  expires_in_days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

router.post("/:invoiceId", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    const invoiceId = idSchema.parse(req.params.invoiceId);
    const payload = createLinkSchema.parse(req.body || {});
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;

    const result = await publicLinkService.createInvoicePublicLink({
      invoiceId,
      organisationId: getOrganisationId(req),
      createdBy: req.user?.id || null,
      baseUrl,
      expiresInDays: payload.expires_in_days,
      req,
    });

    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    return res.status(201).json(ApiResponse.success("INVOICE_PUBLIC_LINK_CREATED", result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Données invalides",
        errors: error.flatten(),
      }));
    }
    return handleServiceError(error, res, next);
  }
});

router.get("/:invoiceId/status", async (req, res, next) => {
  try {
    const invoiceId = idSchema.parse(req.params.invoiceId);
    const result = await publicLinkService.getInvoicePublicLinkStatus({
      invoiceId,
      organisationId: getOrganisationId(req),
    });
    return res.status(200).json(ApiResponse.success("INVOICE_PUBLIC_LINK_STATUS", result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }
    return handleServiceError(error, res, next);
  }
});

router.delete("/:invoiceId", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;

    const invoiceId = idSchema.parse(req.params.invoiceId);
    const result = await publicLinkService.revokeInvoicePublicLink({
      invoiceId,
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id || null,
      req,
    });

    return res.status(200).json(ApiResponse.success("INVOICE_PUBLIC_LINK_REVOKED", result));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }
    return handleServiceError(error, res, next);
  }
});

module.exports = router;
