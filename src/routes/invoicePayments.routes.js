const express = require("express");
const { z } = require("zod");

const ApiResponse = require("../utils/apiResponse");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const { requireOrganisation } = require("../middleware/organization.middleware");
const paymentService = require("../services/invoice/invoice-payment-record.service");
const customerReversalService = require("../services/business/customer-reversal.service");

const router = express.Router();
// listInvoicePayments()/loadInvoiceBalance() lisent invoices/invoice_payments
// (RLS FORCE) via db.query() direct : sans ce middleware, l'historique des
// paiements retourne toujours "Facture introuvable", même pour une facture
// existante.
router.use(requireOrganisation);

const invoiceParamSchema = z.object({ id: z.coerce.number().int().positive() });
const paymentParamSchema = z.object({ paymentId: z.coerce.number().int().positive() });
const paymentSchema = z.object({
  amount: z.coerce.number().positive(),
  method: z.enum(paymentService.PAYMENT_METHODS),
  external_reference: z.string().trim().max(255).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  idempotency_key: z.string().trim().min(8).max(255),
  received_at: z.string().datetime({ offset: true }).optional().nullable(),
});
const reversalSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  idempotency_key: z.string().trim().min(8).max(255),
  reversed_at: z.string().datetime({ offset: true }).optional().nullable(),
});
const voidSchema = z.object({
  reason: z.string().trim().min(3).max(2000),
  idempotency_key: z.string().trim().min(8).max(255),
  voided_at: z.string().datetime({ offset: true }).optional().nullable(),
});
const creditNoteSchema = z.object({
  subtotal: z.coerce.number().positive(),
  tax_total: z.coerce.number().min(0).optional().default(0),
  reason: z.string().trim().min(3).max(2000),
  idempotency_key: z.string().trim().min(8).max(255),
  issued_at: z.string().datetime({ offset: true }).optional().nullable(),
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
    if (!params.success) return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: params.error.flatten() }));
    const result = await paymentService.listInvoicePayments({ invoiceId: params.data.id, organisationId: getOrganisationId(req) });
    if (!result) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable" }));
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
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: { params: params.error?.flatten(), body: body.error?.flatten() } }));
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
    if (!result) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable" }));
    return res.status(result.duplicate ? 200 : 201).json(ApiResponse.success(result.duplicate ? "INVOICE_PAYMENT_DUPLICATE" : "INVOICE_PAYMENT_RECORDED", result));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/payments/:paymentId/reverse", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const params = paymentParamSchema.safeParse(req.params);
    const body = reversalSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: { params: params.error?.flatten(), body: body.error?.flatten() } }));
    }
    const result = await customerReversalService.reverseCustomerPayment({
      paymentId: params.data.paymentId,
      organisationId: getOrganisationId(req),
      reason: body.data.reason,
      idempotencyKey: body.data.idempotency_key,
      reversedAt: body.data.reversed_at,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Paiement client introuvable" }));
    return res.status(result.duplicate ? 200 : 201).json(ApiResponse.success(result.duplicate ? "INVOICE_PAYMENT_REVERSAL_DUPLICATE" : "INVOICE_PAYMENT_REVERSED", result));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/invoices/:id/void", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const params = invoiceParamSchema.safeParse(req.params);
    const body = voidSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: { params: params.error?.flatten(), body: body.error?.flatten() } }));
    }
    const result = await customerReversalService.voidInvoice({
      invoiceId: params.data.id,
      organisationId: getOrganisationId(req),
      reason: body.data.reason,
      idempotencyKey: body.data.idempotency_key,
      voidedAt: body.data.voided_at,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable" }));
    return res.status(result.duplicate ? 200 : 201).json(ApiResponse.success(result.duplicate ? "INVOICE_VOID_DUPLICATE" : "INVOICE_VOIDED", result));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

router.post("/invoices/:id/credit-notes", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const params = invoiceParamSchema.safeParse(req.params);
    const body = creditNoteSchema.safeParse(req.body);
    if (!params.success || !body.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { errors: { params: params.error?.flatten(), body: body.error?.flatten() } }));
    }
    const result = await customerReversalService.postCreditNote({
      invoiceId: params.data.id,
      organisationId: getOrganisationId(req),
      subtotal: body.data.subtotal,
      taxTotal: body.data.tax_total,
      reason: body.data.reason,
      idempotencyKey: body.data.idempotency_key,
      issuedAt: body.data.issued_at,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture admissible introuvable" }));
    return res.status(result.duplicate ? 200 : 201).json(ApiResponse.success(result.duplicate ? "CREDIT_NOTE_DUPLICATE" : "CREDIT_NOTE_POSTED", result));
  } catch (error) {
    return handleServiceError(error, res, next);
  }
});

module.exports = router;
