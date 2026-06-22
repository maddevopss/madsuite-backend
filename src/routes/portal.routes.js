const express = require("express");
const router = express.Router();
const portalService = require("../services/portal.service");
const { generateInvoicePdf } = require("../services/invoice/invoice.service");
const db = require("../../db");

router.get("/:token", async (req, res) => {
  try {
    const data = await portalService.getDocumentByToken(req.params.token);
    if (!data) {
      return res.status(404).json({ message: "Lien expiré ou invalide." });
    }
    res.json(data);
  } catch (error) {
    console.error("Erreur GET portal:", error);
    res.status(500).json({ message: "Erreur serveur" });
  }
});

router.post("/:token/action", async (req, res) => {
  try {
    const { action, signature_data } = req.body;
    const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    const result = await portalService.handleEstimateAction(req.params.token, action, signature_data, clientIp);
    res.json({ success: true, document: result });
  } catch (error) {
    console.error("Erreur POST portal action:", error);
    res.status(error.statusCode || 400).json({ message: error.message });
  }
});

router.get("/:token/pdf", async (req, res) => {
  try {
    const data = await portalService.getDocumentByToken(req.params.token);
    if (!data) {
      return res.status(404).json({ message: "Lien expiré ou invalide." });
    }

    if (data.type === "invoice") {
      const { buffer, invoice } = await generateInvoicePdf({
        invoiceId: data.document.id,
        organisationId: data.organisationId,
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${invoice.invoice_number}.pdf"`);
      return res.send(buffer);
    } else {
      return res.status(404).json({ message: "PDF indisponible pour ce type de document." });
    }
  } catch (error) {
    console.error("Erreur GET portal PDF:", error);
    res.status(500).json({ message: "Erreur lors de la génération du PDF" });
  }
});

router.post("/:token/checkout", async (req, res) => {
  try {
    const data = await portalService.getDocumentByToken(req.params.token);

    if (!data || data.type !== "invoice") {
      return res.status(400).json({ message: "Facture introuvable ou invalide pour le paiement." });
    }

    if (data.document.status === "paid") {
      return res.status(400).json({ message: "Cette facture est déjà payée." });
    }

    if (data.document.status !== "finalized") {
      return res.status(400).json({ message: "La facture doit être finalisée avant de pouvoir être payée." });
    }

    const orgRes = await db.query(
      "SELECT stripe_account_id FROM organisations WHERE id = $1",
      [data.organisationId],
    );

    if (!orgRes.rows[0]?.stripe_account_id) {
      return res.status(400).json({ message: "Le paiement en ligne n'est pas configuré pour ce compte." });
    }

    // Générer les URLs de succès/annulation côté serveur (évite manipulation client)
    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get("host")}`;
    const successUrl = `${baseUrl}/portal/${req.params.token}?payment=success`;
    const cancelUrl = `${baseUrl}/portal/${req.params.token}?payment=cancelled`;

    const sessionUrl = await require("../services/stripe.service").createInvoiceCheckoutSession(
      data.document,
      orgRes.rows[0],
      successUrl,
      cancelUrl,
    );

    res.json({ success: true, url: sessionUrl });
  } catch (error) {
    console.error("Erreur POST portal checkout:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
