const express = require("express");
const { z } = require("zod");

const ApiResponse = require("../utils/apiResponse");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const paymentService = require("../services/invoice/invoice-payment-record.service");

const router = express.Router();

const invoiceParamSchema = z.object({ id: z.coerce.number().int().positive() });
const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(paymentService.PAYMENT_METHODS),
  external_reference: z.string().trim().max(255).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  idempotency_key: z.string().trim().min(8).max(255),
  received_at: z.string().datetime({ offset: true }).optional().nullable(),
});

function requireAdmin(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

router.get("/invoices/:id", async (req, res, next) => {
  try {
    const params = invoiceParamSchema.safeParse(req.params);
    if (!params.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: params.error.flatten() }));
    }
    const result = await paymentService.listInvoicePayments({
      invoiceId: params.data.id,
      organisationId: getOrganisationId(req),
    });
    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable" }));
    }
    return res.status(200).json(ApiResponse.success("INVOICE_PAYMENTS", result));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/invoices/:id", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const params = invoiceParamSchema.safeParse(req.params);
    const body = paymentSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        errors: { params: params.error?.flatten(), body: body.error?.flatten() },
      }));
    }

    const result = await paymentService.recordInvoicePayment({
      invoiceId: params.data.id,
      organisationId: getOrganisationId(req),
      amount: body.data.amount,
      method: body.data.method,
      source: "manual",
      externalReference: body.data.external_reference,
      note: body.data.note,
      idempotencyKey: body.data.idempotency_key,
      receivedAt: body.data.received_at,
      createdBy: req.user?.id,
    });

    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable" }));
    }

    return res.status(result.duplicate ? 200 : 201).json(ApiResponse.success(
      result.duplicate ? "INVOICE_PAYMENT_DUPLICATE" : "INVOICE_PAYMENT_RECORDED",
      result,
    ));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

module.exports = router;
