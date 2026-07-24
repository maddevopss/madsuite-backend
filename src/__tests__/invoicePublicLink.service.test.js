jest.mock("../../db", () => ({
  query: jest.fn(),
  pool: { connect: jest.fn() },
}));

jest.mock("../services/auditLog.service", () => ({
  recordBusinessAudit: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../services/invoice/invoice-query.service", () => ({
  getInvoiceById: jest.fn(),
}));

const db = require("../../db");
const { getInvoiceById } = require("../services/invoice/invoice-query.service");
const service = require("../services/invoice/invoice-public-link.service");

describe("invoice-public-link.service", () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValue(client);
  });

  test("crée un jeton opaque et ne persiste que son empreinte", async () => {
    client.query.mockImplementation(async (sql) => {
      if (String(sql).includes("SELECT id, status, invoice_number")) {
        return { rows: [{ id: 41, status: "finalized", invoice_number: "FAC-00041" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await service.createInvoicePublicLink({
      invoiceId: 41,
      organisationId: 7,
      createdBy: 9,
      baseUrl: "https://madsuite.ca/",
      expiresInDays: 30,
    });

    expect(result.portalUrl).toMatch(/^https:\/\/madsuite\.ca\/portal\/[A-Za-z0-9_-]{43}$/);
    const rawToken = result.portalUrl.split("/").pop();
    const insertCall = client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO invoice_public_links"));
    expect(insertCall).toBeTruthy();
    const persistedHash = insertCall[1][2];
    expect(persistedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(persistedHash).toBe(service.hashPublicToken(rawToken));
    expect(JSON.stringify(insertCall[1])).not.toContain(rawToken);
    expect(client.release).toHaveBeenCalled();
  });

  test("refuse de publier une facture brouillon", async () => {
    client.query.mockImplementation(async (sql) => {
      if (String(sql).includes("SELECT id, status, invoice_number")) {
        return { rows: [{ id: 42, status: "draft", invoice_number: "FAC-00042" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(service.createInvoicePublicLink({
      invoiceId: 42,
      organisationId: 7,
      createdBy: 9,
      baseUrl: "https://madsuite.ca",
    })).rejects.toMatchObject({ statusCode: 409 });

    expect(client.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO invoice_public_links"))).toBe(false);
  });

  test("réduit le document public aux champs nécessaires", () => {
    const publicDocument = service.buildPublicInvoiceDocument({
      id: 99,
      organisation_id: 7,
      client_id: 12,
      invoice_number: "FAC-00099",
      status: "finalized",
      issue_date: "2026-07-24",
      due_date: "2026-08-24",
      subtotal: 100,
      tax_total: 15,
      total: 115,
      notes: "Merci",
      client_nom: "Client Public",
      public_token: "legacy-secret",
      items: [{
        id: 1,
        organisation_id: 7,
        time_entry_id: 55,
        description: "Service",
        quantity: 2,
        unit_rate: 50,
        amount: 100,
      }],
    });

    expect(publicDocument).toEqual(expect.objectContaining({
      invoice_number: "FAC-00099",
      total: 115,
      client: { name: "Client Public" },
    }));
    expect(JSON.stringify(publicDocument)).not.toContain("organisation_id");
    expect(JSON.stringify(publicDocument)).not.toContain("client_id");
    expect(JSON.stringify(publicDocument)).not.toContain("time_entry_id");
    expect(JSON.stringify(publicDocument)).not.toContain("legacy-secret");
  });

  test("un jeton invalide est rejeté avant toute requête", async () => {
    await expect(service.getPublicInvoiceContextByToken("123")).resolves.toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  test("un lien actif charge la facture dans sa propre organisation", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        link_id: 5,
        organisation_id: 7,
        invoice_id: 99,
        expires_at: "2026-08-24T00:00:00.000Z",
        status: "finalized",
        organisation_name: "Organisation A",
      }],
    });
    db.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    getInvoiceById.mockResolvedValue({
      id: 99,
      invoice_number: "FAC-00099",
      status: "finalized",
      total: 115,
      items: [],
    });

    const token = "A".repeat(43);
    const context = await service.getPublicInvoiceContextByToken(token);

    expect(getInvoiceById).toHaveBeenCalledWith({ invoiceId: 99, organisationId: 7 });
    expect(context.publicDocument.invoice_number).toBe("FAC-00099");
  });
});
