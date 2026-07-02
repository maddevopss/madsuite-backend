const express = require("express");
const { z } = require("zod");
const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const quoteConversionService = require("../services/quoteConversion.service");
const { recordBusinessAudit } = require("../services/auditLog.service");

const router = express.Router();
router.use(requireOrganisation);

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function assertMutationRole(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

router.post("/:id/convert", async (req, res, next) => {
  try {
    if (!assertMutationRole(req, res)) return;

    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    }
    const quoteId = parsed.data.id;

    const invoice = await quoteConversionService.convertQuoteToInvoice({
      quoteId,
      organisationId: getOrganisationId(req),
      billedBy: req.user?.id ?? null,
      req
    });

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "quote.converted",
      entityType: "estimate", // Quote = Estimate in db
      entityId: quoteId,
      details: {
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      },
      req,
    });

    return res.status(201).json(ApiResponse.success("QUOTE_CONVERTED", invoice));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
