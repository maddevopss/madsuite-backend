const estimateWorkflowService = require("./estimate/estimate-workflow.service");
const analyticsService = require("./analytics.service");

/**
 * Service alias pour la conversion de devis (quotes) en factures.
 * Respecte la règle MADSuite NO FEATURE FRAGMENTATION en réutilisant
 * l'implémentation existante des estimates.
 */
class QuoteConversionService {
  async convertQuoteToInvoice({ quoteId, organisationId, billedBy, req }) {
    // Les 'quotes' sont gérés par le module 'estimates' dans la base de données
    const invoice = await estimateWorkflowService.convertToInvoice({
      estimateId: quoteId,
      organisationId,
      billedBy,
      req
    });

    await analyticsService.trackEvent("quote_converted", {
      organisationId,
      userId: billedBy,
      metadata: {
        quoteId,
        invoiceId: invoice.id
      }
    });

    return invoice;
  }
}

module.exports = new QuoteConversionService();
