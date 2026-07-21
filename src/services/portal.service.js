const db = require("../../db");
const { getInvoiceById } = require("./invoice/invoice.service");
const estimateService = require("./estimate/estimate.service");
const { recordBusinessAudit } = require("./auditLog.service");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidPublicToken(token) {
  return typeof token === "string" && UUID_PATTERN.test(token);
}

class PortalService {
  async getDocumentByToken(token) {
    if (!isValidPublicToken(token)) return null;

    // Check invoices
    const invoiceRes = await db.query(
      `SELECT id, organisation_id FROM invoices WHERE public_token = $1 AND deleted_at IS NULL`,
      [token]
    );

    if (invoiceRes.rows.length > 0) {
      const doc = await getInvoiceById({
        invoiceId: invoiceRes.rows[0].id,
        organisationId: invoiceRes.rows[0].organisation_id
      });
      const orgRes = await db.query(
        "SELECT stripe_account_id, nom FROM organisations WHERE id = $1",
        [invoiceRes.rows[0].organisation_id]
      );
      const org = orgRes.rows[0] || {};
      const hasStripeConnect = !!org.stripe_account_id;
      return {
        type: "invoice",
        document: doc,
        organisationId: invoiceRes.rows[0].organisation_id,
        organisationName: org.nom,
        hasStripeConnect,
      };
    }

    // Check estimates
    const estimateRes = await db.query(
      `SELECT id, organisation_id FROM estimates WHERE public_token = $1 AND deleted_at IS NULL`,
      [token]
    );

    if (estimateRes.rows.length > 0) {
      const doc = await estimateService.getEstimateById(estimateRes.rows[0].id, estimateRes.rows[0].organisation_id);
      const orgRes = await db.query(
        "SELECT nom FROM organisations WHERE id = $1",
        [estimateRes.rows[0].organisation_id]
      );
      return {
        type: "estimate",
        document: doc,
        organisationId: estimateRes.rows[0].organisation_id,
        organisationName: orgRes.rows[0]?.nom,
      };
    }

    return null;
  }

  async handleEstimateAction(token, action, signatureData, clientIp) {
    if (!["accepted", "rejected"].includes(action)) {
      throw new Error("Action invalide");
    }

    if (!isValidPublicToken(token)) {
      throw new Error("Document introuvable");
    }

    const estimateRes = await db.query(
      `SELECT id, organisation_id, status FROM estimates WHERE public_token = $1 AND deleted_at IS NULL`,
      [token]
    );

    if (estimateRes.rows.length === 0) {
      throw new Error("Document introuvable");
    }

    const { id, organisation_id, status } = estimateRes.rows[0];

    if (status !== "sent") {
      const err = new Error(`Cette soumission ne peut plus être modifiée car elle est déjà ${status}`);
      err.statusCode = 400;
      throw err;
    }

    // Stocker la signature si fournie
    const updateParams = [action, id, organisation_id];
    let signatureClause = "";
    if (signatureData && action === "accepted") {
      signatureClause = ", signature_data = $4, signed_at = CURRENT_TIMESTAMP, signed_ip = $5";
      updateParams.push(signatureData, clientIp || null);
    }

    const result = await db.query(
      `UPDATE estimates SET status = $1, updated_at = CURRENT_TIMESTAMP${signatureClause} WHERE id = $2 AND organisation_id = $3 RETURNING *`,
      updateParams
    );

    await recordBusinessAudit({
      organisationId: organisation_id,
      actorUserId: null, // C'est le client qui a cliqué
      action: `estimate.${action}_via_portal`,
      entityType: "estimate",
      entityId: id,
      details: { via: "public_token", hasSigned: !!signatureData },
      req: null
    });

    return result.rows[0];
  }
}

module.exports = new PortalService();