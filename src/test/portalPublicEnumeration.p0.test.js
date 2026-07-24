const { randomBytes, randomUUID } = require("crypto");
const db = require("../../db");
const portalService = require("../services/portal.service");
const { hashPublicToken } = require("../services/invoice/invoice-public-link.service");
const {
  createTestOrganisation,
  createTestClient,
} = require("./helpers/testData");

async function createPublicInvoice({ organisationId, clientId, invoiceNumber, publicToken }) {
  const invoiceResult = await db.query(
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
        finalized_at,
        snapshot
      )
      VALUES (
        $1, $2, $3, 'sent', CURRENT_DATE,
        CURRENT_DATE + INTERVAL '15 days', 100, 0, 100,
        NOW(),
        '{"subtotal":100,"tax_total":0,"total":100,"items":[]}'::jsonb
      )
      RETURNING *
    `,
    [organisationId, clientId, invoiceNumber],
  );

  const invoice = invoiceResult.rows[0];
  await db.query(
    `
      INSERT INTO invoice_public_links (
        organisation_id,
        invoice_id,
        token_hash,
        expires_at
      )
      VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')
    `,
    [organisationId, invoice.id, hashPublicToken(publicToken)],
  );

  return invoice;
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
    ` ${validToken}`,
    `${validToken} `,
    `${organisationId}:${invoiceId}`,
    randomUUID(),
  ];
}

describe("P0 — portail public non énumérable entre organisations", () => {
  test("seul le jeton public exact révèle son propre document sans identifiants internes", async () => {
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

    const tokenA = randomBytes(32).toString("base64url");
    const tokenB = randomBytes(32).toString("base64url");
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
      organisationName: organisationA.nom,
    });
    expect(documentA.document).toMatchObject({
      invoice_number: invoiceA.invoice_number,
      client: { name: clientA.nom },
    });

    expect(documentB).toMatchObject({
      type: "invoice",
      organisationName: organisationB.nom,
    });
    expect(documentB.document).toMatchObject({
      invoice_number: invoiceB.invoice_number,
      client: { name: clientB.nom },
    });

    expect(documentA.document.invoice_number).not.toBe(invoiceB.invoice_number);
    expect(documentB.document.invoice_number).not.toBe(invoiceA.invoice_number);

    const serializedA = JSON.stringify(documentA);
    const serializedB = JSON.stringify(documentB);
    for (const serialized of [serializedA, serializedB]) {
      expect(serialized).not.toContain("organisation_id");
      expect(serialized).not.toContain("client_id");
      expect(serialized).not.toContain("time_entry_id");
      expect(serialized).not.toContain("token_hash");
    }

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