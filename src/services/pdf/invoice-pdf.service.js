const { jsPDF } = require("jspdf");
const { getInvoiceBranding } = require("./pdf-branding.service");
const { renderTemplate } = require("./pdf-template.service");
const { getOrganisationSettings } = require("../organisation.service");

/**
 * Orchestrates the generation of an invoice PDF.
 * It combines the branding, the invoice data, and the template.
 */
async function generateInvoicePdfBuffer(invoice, organisationId) {
  const doc = new jsPDF();
  
  // Fetch organisation settings and branding info
  const organisation = await getOrganisationSettings(organisationId);
  const branding = await getInvoiceBranding(organisationId);

  // Render the PDF template
  renderTemplate(doc, invoice, branding, organisation);

  // Output as buffer
  return Buffer.from(doc.output("arraybuffer"));
}

module.exports = {
  generateInvoicePdfBuffer,
};
