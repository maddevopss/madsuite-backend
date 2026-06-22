const express = require("express");
const { z } = require("zod");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const invoiceService = require("../services/invoice/invoice.service");
const stripeService = require("../services/stripe.service");
const { getOrganisationSettings } = require("../services/organisation.service");
const router = express.Router();

router.use(requireOrganisation);

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");

const createInvoiceSchema = z.object({
  client_id: z.coerce.number().int().positive(),
  time_entry_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
  expense_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
  tax_rate: z.coerce.number().min(0).max(100).optional().default(0),
  notes: z.string().max(5000).optional().nullable(),
  issue_date: dateStringSchema.optional(),
  due_date: dateStringSchema.optional(),
  custom_descriptions: z.record(z.string().max(1000)).optional(),
  idempotency_key: z.string().max(100).optional(),
});

const updateInvoiceSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "void"]).optional(),
  issue_date: dateStringSchema.optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  version: z.number().int().positive().optional(),
});

const listInvoicesQuerySchema = z.object({
  status: z.enum(["draft", "sent", "paid", "void"]).optional(),
  client_id: z.coerce.number().int().positive().optional(),
});

const unbilledEntriesQuerySchema = z.object({
  client_id: z.coerce.number().int().positive(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function parseInvoiceId(req, res) {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json(ApiResponse.error("VALIDATION_ERROR", { message: "ID invalide" }));
    return null;
  }
  return parsed.data.id;
}

function assertInvoiceMutationRole(req, res) {
  if (req.user?.role !== "admin") {
    res.status(403).json(ApiResponse.error("FORBIDDEN", { message: "Permissions insuffisantes" }));
    return false;
  }
  return true;
}

router.get("/recurring/list", async (req, res, next) => {
  try {
    const recurrences = await invoiceService.getRecurringInvoices(getOrganisationId(req));
    return res.status(200).json(ApiResponse.success("RECURRING_INVOICES_LISTED", recurrences));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const parsed = listInvoicesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Parametres invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const invoices = await invoiceService.listInvoices({
      organisationId: getOrganisationId(req),
      status: parsed.data.status,
      clientId: parsed.data.client_id,
    });

    return res.status(200).json(ApiResponse.success("INVOICE_LISTED", invoices));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/unbilled-entries", async (req, res, next) => {
  try {
    const parsed = unbilledEntriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Parametres invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const entries = await invoiceService.listUnbilledEntries({
      clientId: parsed.data.client_id,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("INVOICE_UNBILLED_ENTRIES_LISTED", entries));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/unbilled-expenses", async (req, res, next) => {
  try {
    const parsed = unbilledEntriesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Parametres invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const expenses = await invoiceService.listUnbilledExpenses({
      clientId: parsed.data.client_id,
      organisationId: getOrganisationId(req),
    });

    return res.status(200).json(ApiResponse.success("INVOICE_UNBILLED_EXPENSES_LISTED", expenses));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/", async (req, res, next) => {
  try {
    if (!assertInvoiceMutationRole(req, res)) return;

    const parsed = createInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const invoice = await invoiceService.createInvoiceFromEntries({
      clientId: parsed.data.client_id,
      timeEntryIds: parsed.data.time_entry_ids,
      expenseIds: parsed.data.expense_ids,
      issueDate: parsed.data.issue_date,
      dueDate: parsed.data.due_date,
      notes: parsed.data.notes,
      taxRate: parsed.data.tax_rate,
      customDescriptions: parsed.data.custom_descriptions,
      idempotencyKey: parsed.data.idempotency_key,
      organisationId: getOrganisationId(req),
      billedBy: req.user?.id ?? null,
      req,
    });

    return res.status(201).json(ApiResponse.success("INVOICE_CREATED", invoice));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const invoice = await invoiceService.getInvoiceById({
      invoiceId,
      organisationId: getOrganisationId(req),
    });

    if (!invoice) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("INVOICE_RETRIEVED", invoice));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/:id/pdf", async (req, res, next) => {
  try {
    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const result = await invoiceService.generateInvoicePdf({
      invoiceId,
      organisationId: getOrganisationId(req),
    });

    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="invoice-${invoiceId}.pdf"`);
    return res.status(200).send(result.buffer);
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    if (!assertInvoiceMutationRole(req, res)) return;

    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const parsed = updateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const invoice = await invoiceService.updateInvoice({
      invoiceId,
      organisationId: getOrganisationId(req),
      data: parsed.data,
      req,
    });

    if (!invoice) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("INVOICE_UPDATED", invoice));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/:id/finalize", async (req, res, next) => {
  try {
    if (!assertInvoiceMutationRole(req, res)) return;

    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const invoice = await invoiceService.freezeInvoiceSnapshot(invoiceId, getOrganisationId(req));

    return res.status(200).json(ApiResponse.success("INVOICE_FINALIZED", invoice));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!assertInvoiceMutationRole(req, res)) return;

    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const deleted = await invoiceService.deleteInvoice({
      invoiceId,
      organisationId: getOrganisationId(req),
      req,
    });

    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("INVOICE_DELETED", {
      deletedId: deleted.id,
      releasedEntries: deleted.released_entries || 0,
    }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.get("/:id/portal-link", async (req, res, next) => {
  try {
    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const baseUrl = process.env.FRONTEND_URL || process.env.VITE_API_URL || `${req.protocol}://${req.get("host")}`;

    const linkInfo = await invoiceService.getPortalLink({
      invoiceId,
      organisationId: getOrganisationId(req),
      baseUrl,
    });

    if (!linkInfo) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("PORTAL_LINK", linkInfo));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/:id/send", async (req, res, next) => {
  try {
    if (!assertInvoiceMutationRole(req, res)) return;

    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;

    const result = await invoiceService.markInvoiceAsSent({
      invoiceId,
      organisationId: getOrganisationId(req),
      req,
      baseUrl,
    });

    if (!result) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    return res.status(200).json(ApiResponse.success("INVOICE_SENT", result));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

const recurringSchema = z.object({
  frequency: z.enum(["weekly", "monthly", "yearly"]),
  next_issue_date: dateStringSchema
});

router.post("/:id/recurring", async (req, res, next) => {
  try {
    if (!assertInvoiceMutationRole(req, res)) return;
    
    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const parsed = recurringSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(ApiResponse.error("VALIDATION_ERROR", {
        message: "Donnees invalides",
        errors: parsed.error.flatten(),
      }));
    }

    const result = await invoiceService.makeInvoiceRecurring({
      invoiceId,
      organisationId: getOrganisationId(req),
      frequency: parsed.data.frequency,
      nextIssueDate: parsed.data.next_issue_date,
      req
    });

    return res.status(201).json(ApiResponse.success("RECURRING_INVOICE_CREATED", result));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/:id/checkout", async (req, res, next) => {
  try {
    // Both admin and client portal might call this, but here it's behind requireOrganisation
    // Typically, the client portal has its own route. This one is for the app user.
    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    const organisationId = getOrganisationId(req);
    const invoice = await invoiceService.getInvoiceById({ invoiceId, organisationId });
    if (!invoice) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    const organisation = await getOrganisationSettings(organisationId);
    
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const successUrl = `${baseUrl}/invoices?payment=success&invoice_id=${invoiceId}`;
    const cancelUrl = `${baseUrl}/invoices?payment=cancelled&invoice_id=${invoiceId}`;

    const sessionUrl = await stripeService.createInvoiceCheckoutSession(
      invoice,
      organisation,
      successUrl,
      cancelUrl
    );

    return res.status(200).json(ApiResponse.success("CHECKOUT_SESSION_CREATED", { url: sessionUrl }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
