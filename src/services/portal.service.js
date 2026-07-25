const db = require("../../db");
const {
  getPublicInvoiceContextByToken,
} = require("./invoice/invoice-public-link.service");
const {
  getPublicEstimateContextByToken,
  decidePublicEstimate,
} = require("./estimate/estimate-public-link.service");

class PortalService {
  async getInvoiceContextByToken(token) {
    return getPublicInvoiceContextByToken(token);
  }

  async getEstimateContextByToken(token) {
    return getPublicEstimateContextByToken(token);
  }

  async getDocumentByToken(token) {
    const invoiceContext = await this.getInvoiceContextByToken(token);
    if (invoiceContext) {
      const orgRes = await db.query(
        "SELECT stripe_account_id FROM organisations WHERE id = $1",
        [invoiceContext.organisationId],
      );
      return {
        type: "invoice",
        document: invoiceContext.publicDocument,
        organisationName: invoiceContext.organisationName,
        expiresAt: invoiceContext.expiresAt,
        hasStripeConnect: Boolean(orgRes.rows[0]?.stripe_account_id),
      };
    }

    const estimateContext = await this.getEstimateContextByToken(token);
    if (!estimateContext) return null;
    return {
      type: "estimate",
      document: estimateContext.publicDocument,
      organisationName: estimateContext.organisationName,
      expiresAt: estimateContext.expiresAt,
      hasStripeConnect: false,
    };
  }

  async handleEstimateAction(token, action, payload, clientIp) {
    return decidePublicEstimate({
      token,
      decision: action,
      signerName: payload?.signer_name,
      consentConfirmed: payload?.consent_confirmed,
      clientIp,
    });
  }
}

module.exports = new PortalService();