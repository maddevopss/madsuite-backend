const db = require("../../db");
const portalService = require("../services/portal.service");
const {
  createTestOrganisation,
  createTestClient,
} = require("./helpers/testData");

async function createPublicInvoice({ organisationId, clientId, invoiceNumber, publicToken }) {
  const result = await db.query(
    `
      INSERT INTO invoices (
        organisation_id,
        client_id,
        invoice_number,
        status,
        issue_date,
        due_date,
        subtotal,
        tax_total,
        total,
        public_token
      )
      VALUES ($1, $2, $3, 'sent', CURRENT_DATE, CURRENT_DATE + INTERVAL '15 days', 100, 0, 100, $4)
      RETURNING *
    `,
    [organisationId, clientId, invoiceNumber, publicToken],
  );

  return result.rows[0];
}

function buildInvalidTokenVariants({ validToken, invoiceId, organisationId }) {
  const last = validToken.slice(-1);
  const replacement = last === "a" ? "b" : "a";

  return [
    "",
    "invalid",
    String(invoiceId),
    String(organisationId),
    `INV_${invoiceId}`,
    validToken.slice(0, -1),
    `${validToken}${replacement}`,
    `${validToken.slice(0, -1)}${replacement}`,
    validToken.toUpperCase(),
    ` ${validToken}`,
    `${validToken} `,
    `${organisationId}:${invoiceId}`,
  ];
}

describe("P0 — portail public non énumérable entre organisations", () => {
  test("seul le jeton public exact révèle son propre document", async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const organisationA = await createTestOrganisation({ nom: `Org portail A ${suffix}` });
    const organisationB = await createTestOrganisation({ nom: `Org portail B ${suffix}` });
    const clientA = await createTestClient({
      nom: `Client portail A ${suffix}`,
      organisation_id: organisationA.id,
    });
    const clientB = await createTestClient({
      nom: `Client portail B ${suffix}`,
      organisation_id: organisationB.id,
    });

    const tokenA = `portal-a-${suffix}`;
    const tokenB = `portal-b-${suffix}`;
    const invoiceA = await createPublicInvoice({
      organisationId: organisationA.id,
      clientId: clientA.id,
      invoiceNumber: `INV-PORTAL-A-${suffix}`,
      publicToken: tokenA,
    });
    const invoiceB = await createPublicInvoice({
      organisationId: organisationB.id,
      clientId: clientB.id,
      invoiceNumber: `INV-PORTAL-B-${suffix}`,
      publicToken: tokenB,
    });

    const documentA = await portalService.getDocumentByToken(tokenA);
    const documentB = await portalService.getDocumentByToken(tokenB);

    expect(documentA).toMatchObject({
      type: "invoice",
      organisationId: organisationA.id,
      organisationName: organisationA.nom,
    });
    expect(documentA.document).toMatchObject({
      id: invoiceA.id,
      invoice_number: invoiceA.invoice_number,
      organisation_id: organisationA.id,
    });

    expect(documentB).toMatchObject({
      type: "invoice",
      organisationId: organisationB.id,
      organisationName: organisationB.nom,
    });
    expect(documentB.document).toMatchObject({
      id: invoiceB.id,
      invoice_number: invoiceB.invoice_number,
      organisation_id: organisationB.id,
    });

    expect(documentA.document.invoice_number).not.toBe(invoiceB.invoice_number);
    expect(documentB.document.invoice_number).not.toBe(invoiceA.invoice_number);

    const invalidTokens = [
      ...buildInvalidTokenVariants({
        validToken: tokenA,
        invoiceId: invoiceA.id,
        organisationId: organisationA.id,
      }),
      ...buildInvalidTokenVariants({
        validToken: tokenB,
        invoiceId: invoiceB.id,
        organisationId: organisationB.id,
      }),
    ];

    const invalidResults = await Promise.all(
      [...new Set(invalidTokens)]
        .filter((token) => token !== tokenA && token !== tokenB)
        .map((token) => portalService.getDocumentByToken(token)),
    );

    expect(invalidResults.every((result) => result === null)).toBe(true);
  }, 30000);
});
