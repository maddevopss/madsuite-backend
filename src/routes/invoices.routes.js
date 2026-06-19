const express = require("express");
const { z } = require("zod");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");
const invoiceService = require("../services/invoice.service");
const { recordBusinessAudit } = require("../services/auditLog.service");

const router = express.Router();

router.use(requireOrganisation);

const dateStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date invalide");

const createInvoiceSchema = z.object({
  client_id: z.coerce.number().int().positive(),
  time_entry_ids: z.array(z.coerce.number().int().positive()).min(1).refine(
    (ids) => new Set(ids).size === ids.length,
    { message: "Les time_entry_ids doivent etre uniques" },
  ),
  tax_rate: z.coerce.number().min(0).max(100).optional().default(0),
  notes: z.string().max(5000).optional().nullable(),
  issue_date: dateStringSchema.optional(),
  due_date: dateStringSchema.optional(),
});

const updateInvoiceSchema = z.object({
  status: z.enum(["draft", "sent", "paid", "void"]).optional(),
  issue_date: dateStringSchema.optional().nullable(),
  due_date: dateStringSchema.optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
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
      issueDate: parsed.data.issue_date,
      dueDate: parsed.data.due_date,
      notes: parsed.data.notes,
      taxRate: parsed.data.tax_rate,
      organisationId: getOrganisationId(req),
      billedBy: req.user?.id ?? null,
    });

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "invoice.created",
      entityType: "invoice",
      entityId: invoice.id,
      details: {
        clientId: parsed.data.client_id,
        timeEntryCount: parsed.data.time_entry_ids.length,
      },
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
    });

    if (!invoice) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "invoice.updated",
      entityType: "invoice",
      entityId: invoice.id,
      details: {
        status: parsed.data.status ?? null,
        issueDate: parsed.data.issue_date ?? null,
        dueDate: parsed.data.due_date ?? null,
      },
      req,
    });

    return res.status(200).json(ApiResponse.success("INVOICE_UPDATED", invoice));
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
    });

    if (!deleted) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "invoice.deleted",
      entityType: "invoice",
      entityId: deleted.id,
      details: {
        releasedEntries: deleted.released_entries || 0,
      },
      req,
    });

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

    const result = await require("../../db").query(
      `SELECT id, public_token, status FROM invoices WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
      [invoiceId, require("../utils/organisationScope").organisationValue(getOrganisationId(req))],
    );

    if (!result.rows[0]) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    const { public_token, status } = result.rows[0];
    const baseUrl = process.env.FRONTEND_URL || process.env.VITE_API_URL || `${req.protocol}://${req.get("host")}`;
    const portalUrl = `${baseUrl}/portal/${public_token}`;

    return res.status(200).json(ApiResponse.success("PORTAL_LINK", { portalUrl, public_token, status }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

router.post("/:id/send", async (req, res, next) => {
  try {
    if (!assertInvoiceMutationRole(req, res)) return;

    const invoiceId = parseInvoiceId(req, res);
    if (!invoiceId) return;

    // Marquer la facture comme "sent"
    const invoice = await invoiceService.updateInvoice({
      invoiceId,
      organisationId: getOrganisationId(req),
      data: { status: "sent" },
    });

    if (!invoice) {
      return res.status(404).json(ApiResponse.error("NOT_FOUND", { message: "Facture introuvable." }));
    }

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const portalUrl = `${baseUrl}/portal/${invoice.public_token}`;

    await recordBusinessAudit({
      organisationId: getOrganisationId(req),
      actorUserId: req.user?.id ?? null,
      action: "invoice.sent",
      entityType: "invoice",
      entityId: invoice.id,
      details: { portalUrl },
      req,
    });

    return res.status(200).json(ApiResponse.success("INVOICE_SENT", { invoice, portalUrl }));
  } catch (err) {
    return handleServiceError(err, res, next);
  }
});

module.exports = router;
