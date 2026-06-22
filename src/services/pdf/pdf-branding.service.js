const db = require("../../../db");

/**
 * Parses brand color from string to RGB array.
 */
function parseBrandColor(value) {
  const match = String(value || "").match(/^#?([0-9a-f]{6})$/i);
  if (!match) return [41, 82, 155]; // MADSuite blue default
  const hex = match[1];
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
}

/**
 * Retrieves the branding information for an invoice PDF.
 * Combines organisation settings with environment fallbacks.
 */
async function getInvoiceBranding(organisationId = null) {
  let orgName = process.env.INVOICE_BRAND_NAME || process.env.APP_NAME || "MADSuite";
  
  if (organisationId) {
    const orgResult = await db.query("SELECT nom FROM organisations WHERE id = $1", [organisationId]);
    if (orgResult.rowCount > 0) {
      orgName = orgResult.rows[0].nom;
    }
  }

  return {
    name: orgName,
    email: process.env.INVOICE_BRAND_EMAIL || "",
    phone: process.env.INVOICE_BRAND_PHONE || "",
    website: process.env.INVOICE_BRAND_WEBSITE || "",
    address: process.env.INVOICE_BRAND_ADDRESS || "",
    taxNumbers: process.env.INVOICE_TAX_NUMBERS || "",
    currency: process.env.INVOICE_CURRENCY || "CAD",
    paymentTerms: process.env.INVOICE_PAYMENT_TERMS || "",
    footer: process.env.INVOICE_BRAND_FOOTER || `Généré par MADSuite`,
    color: parseBrandColor(process.env.INVOICE_BRAND_COLOR),
  };
}

module.exports = {
  getInvoiceBranding,
  parseBrandColor,
};
