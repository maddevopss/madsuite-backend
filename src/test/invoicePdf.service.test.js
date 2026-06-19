const { getInvoiceBranding } = require("../services/invoicePdf.service");

describe("invoicePdf.service", () => {
  const envKeys = [
    "INVOICE_BRAND_NAME",
    "INVOICE_BRAND_EMAIL",
    "INVOICE_BRAND_COLOR",
    "INVOICE_BRAND_FOOTER",
    "INVOICE_TAX_NUMBERS",
    "INVOICE_CURRENCY",
    "INVOICE_PAYMENT_TERMS",
  ];
  const previousEnv = {};

  beforeEach(() => {
    for (const key of envKeys) {
      previousEnv[key] = process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousEnv[key];
      }
    }
  });

  test("lit le branding facture depuis les variables d'environnement", () => {
    process.env.INVOICE_BRAND_NAME = "MADSuite Studio";
    process.env.INVOICE_BRAND_EMAIL = "billing@example.com";
    process.env.INVOICE_BRAND_COLOR = "#123abc";
    process.env.INVOICE_BRAND_FOOTER = "Merci";
    process.env.INVOICE_TAX_NUMBERS = "TPS 123 / TVQ 456";
    process.env.INVOICE_CURRENCY = "CAD";
    process.env.INVOICE_PAYMENT_TERMS = "Payable dans les 15 jours";

    expect(getInvoiceBranding()).toMatchObject({
      name: "MADSuite Studio",
      email: "billing@example.com",
      footer: "Merci",
      taxNumbers: "TPS 123 / TVQ 456",
      currency: "CAD",
      paymentTerms: "Payable dans les 15 jours",
      color: [18, 58, 188],
    });
  });

  test("utilise une couleur par defaut si la valeur est invalide", () => {
    process.env.INVOICE_BRAND_COLOR = "not-a-color";

    expect(getInvoiceBranding().color).toEqual([41, 82, 155]);
  });
});
