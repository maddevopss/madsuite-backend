const express = require("express");
const { z } = require("zod");

const router = express.Router();
const auth = require("../middleware/auth");
const portalService = require("../services/portal.service");
const invoicePublicLinksRoutes = require("./invoicePublicLinks.routes");
const estimatePublicLinksRoutes = require("./estimatePublicLinks.routes");
const { generateInvoicePdfBuffer } = require("../services/pdf/invoice-pdf.service");
const { requireModule, requireModuleForOrg } = require("../middleware/requireModule");
const db = require("../../db");
const logger = require("../config/logger");

const estimateActionSchema = z.object({
  action: z.enum(["accepted", "rejected"]),
  signer_name: z.string().trim().min(2).max(255),
  consent_confirmed: z.boolean().optional().default(false),
});

async function hasOrgModule(organisationId, moduleKey) {
  return requireModuleForOrg(moduleKey, organisationId)();
}

async function ensurePortalModule(res, organisationId, moduleKey) {
  const hasAccess = await hasOrgModule(organisationId, moduleKey);
  if (hasAccess) return true;
  res.status(403).json({
    success: false,
    code: "MODULE_NOT_AVAILABLE",
    message: `Le module "${moduleKey}" n'est pas disponible pour cette organisation.`,
    module_key: moduleKey,
  });
  return false;
}

function setPrivatePortalHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}

function safePdfFilename(invoiceNumber) {
  const normalized = String(invoiceNumber || "facture")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${normalized || "facture"}.pdf`;
}

router.use("/manage/invoices", auth, requireModule("invoices"), invoicePublicLinksRoutes);
router.use("/manage/estimates", auth, requireModule("estimates"), estimatePublicLinksRoutes);

router.use((req, res, next) => {
  setPrivatePortalHeaders(res);
  next();
});

router.get("/:token", async (req, res) => {
  try {
    const data = await portalService.getDocumentByToken(req.params.token);
    if (!data) return res.status(404).json({ message: "Lien expiré ou invalide." });
    return res.status(200).json(data);
  } catch (error) {
    logger.error("Erreur GET portal", { error: error.message });
    return res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/:token/action", async (req, res) => {
  try {
    const parsed = estimateActionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ message: "Données de décision invalides.", errors: parsed.error.flatten() });
    }
    if (parsed.data.action === "accepted" && parsed.data.consent_confirmed !== true) {
      return res.status(400).json({ message: "Le consentement doit être confirmé pour accepter la soumission." });
    }
    const forwarded = req.headers["x-forwarded-for"];
    const clientIp = Array.isArray(forwarded) ? forwarded[0] : String(forwarded || req.socket.remoteAddress || "").split(",")[0].trim();
    const result = await portalService.handleEstimateAction(
      req.params.token,
      parsed.data.action,
      parsed.data,
      clientIp,
    );
    if (!result) return res.status(404).json({ message: "Lien expiré ou invalide." });
    return res.status(200).json({ success: true, decision: result });
  } catch (error) {
    logger.error("Erreur POST portal action", { error: error.message });
    return res.status(error.statusCode || 400).json({ message: error.message });
  }
});

router.get("/:token/pdf", async (req, res) => {
  try {
    const context = await portalService.getInvoiceContextByToken(req.params.token);
    if (!context) return res.status(404).json({ message: "Lien expiré ou invalide." });
    const buffer = await generateInvoicePdfBuffer(context.invoice, context.organisationId);
    const filename = safePdfFilename(context.invoice.invoice_number);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    logger.error("Erreur GET portal PDF", { error: error.message });
    return res.status(500).json({ message: "Erreur lors de la génération du PDF" });
  }
});

router.post("/:token/checkout", async (req, res) => {
  try {
    const context = await portalService.getInvoiceContextByToken(req.params.token);
    if (!context) return res.status(400).json({ message: "Facture introuvable ou invalide pour le paiement." });
    if (!(await ensurePortalModule(res, context.organisationId, "payments"))) return;
    if (context.invoice.status === "paid") return res.status(400).json({ message: "Cette facture est déjà payée." });
    if (!context.invoice.finalized_at || context.invoice.status !== "sent") {
      return res.status(400).json({ message: "La facture doit être finalisée et envoyée avant de pouvoir être payée." });
    }
    const orgRes = await db.query("SELECT stripe_account_id FROM organisations WHERE id = $1", [context.organisationId]);
    if (!orgRes.rows[0]?.stripe_account_id) {
      return res.status(400).json({ message: "Le paiement en ligne n'est pas configuré pour ce compte." });
    }
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const successUrl = `${baseUrl}/portal/${req.params.token}?payment=success`;
    const cancelUrl = `${baseUrl}/portal/${req.params.token}?payment=cancelled`;
    const sessionUrl = await require("../services/stripe.service").createInvoiceCheckoutSession(
      context.invoice,
      orgRes.rows[0],
      successUrl,
      cancelUrl,
    );
    return res.json({ success: true, url: sessionUrl });
  } catch (error) {
    logger.error("Erreur POST portal checkout", { error: error.message });
    return res.status(500).json({ message: "Impossible de préparer le paiement." });
  }
});

module.exports = router;