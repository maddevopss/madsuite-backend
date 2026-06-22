const { getInvoiceBranding } = require("../services/pdf/pdf-branding.service");

test("lit le branding facture depuis les variables d'environnement", async () => {
  process.env.INVOICE_BRAND_NAME = "MADSuite Studio";
  process.env.INVOICE_BRAND_EMAIL = "billing@example.com";
  process.env.INVOICE_BRAND_COLOR = "#123abc";
  process.env.INVOICE_BRAND_FOOTER = "Merci";
  process.env.INVOICE_TAX_NUMBERS = "TPS 123 / TVQ 456";
  process.env.INVOICE_CURRENCY = "CAD";
  process.env.INVOICE_PAYMENT_TERMS = "Payable dans les 15 jours";

  const branding = await getInvoiceBranding();

  expect(branding).toMatchObject({
    name: "MADSuite Studio",
    email: "billing@example.com",
    footer: "Merci",
    taxNumbers: "TPS 123 / TVQ 456",
    currency: "CAD",
    paymentTerms: "Payable dans les 15 jours",
    color: [18, 58, 188],
  });
});

test("utilise une couleur par defaut si la valeur est invalide", async () => {
  process.env.INVOICE_BRAND_COLOR = "not-a-color";

  const branding = await getInvoiceBranding();

  expect(branding.color).toEqual([41, 82, 155]);
});
