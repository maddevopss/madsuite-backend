jest.mock("../../db", () => ({ connect: jest.fn() }));

const db = require("../../db");
const {
  convertLeadToClient,
  normalizeIdempotencyKey,
} = require("../services/customerGrowth/leadConversion.service");

function createTxClient(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

function qualifiedLead(overrides = {}) {
  return {
    id: 12,
    organisation_id: 7,
    status: "qualified",
    display_name: "Jeanne Tremblay",
    company_name: "Atelier Tremblay",
    email: "jeanne@example.com",
    phone: "514-555-0101",
    notes: "Prospect prioritaire",
    converted_client_id: null,
    conversion_idempotency_key: null,
    ...overrides,
  };
}

describe("customer growth lead conversion service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("normalise une clé d'idempotence", () => {
    expect(normalizeIdempotencyKey("  conversion-12  ")).toBe("conversion-12");
  });

  test("refuse une clé d'idempotence absente", () => {
    expect(() => normalizeIdempotencyKey("  ")).toThrow("clé d'idempotence valide");
  });

  test("convertit un prospect qualifié dans une seule transaction", async () => {
    const lead = qualifiedLead();
    const createdClient = { id: 44, nom: "Atelier Tremblay", organisation_id: 7 };
    const convertedLead = {
      ...lead,
      status: "converted",
      converted_client_id: 44,
      conversion_idempotency_key: "conversion-12",
    };

    const tx = createTxClient(async (sql, params) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2") && sql.includes("SELECT")) return { rows: [] };
      if (sql.includes("FROM sales_leads") && sql.includes("id = $1")) {
        expect(params).toEqual([12, 7]);
        expect(sql).toContain("FOR UPDATE");
        return { rows: [lead] };
      }
      if (sql.includes("INSERT INTO clients")) {
        expect(params).toEqual([
          "Atelier Tremblay",
          0,
          "jeanne@example.com",
          "514-555-0101",
          "Jeanne Tremblay",
          "Prospect prioritaire",
          7,
        ]);
        return { rows: [createdClient] };
      }
      if (sql.includes("UPDATE sales_leads")) {
        expect(params).toEqual([44, "conversion-12", 12, 7]);
        return { rows: [convertedLead] };
      }
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    const result = await convertLeadToClient({
      leadId: 12,
      organisationId: 7,
      idempotencyKey: "conversion-12",
    });

    expect(result).toEqual({ lead: convertedLead, client: createdClient, idempotent: false });
    expect(tx.query).toHaveBeenCalledWith("BEGIN");
    expect(tx.query).toHaveBeenCalledWith("COMMIT");
    expect(tx.release).toHaveBeenCalledTimes(1);
  });

  test("utilise le nom du prospect quand aucune entreprise n'est fournie", async () => {
    const lead = qualifiedLead({ company_name: null });
    const createdClient = { id: 45, nom: "Jeanne Tremblay", organisation_id: 7 };

    const tx = createTxClient(async (sql, params) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2") && sql.includes("SELECT")) return { rows: [] };
      if (sql.includes("FROM sales_leads") && sql.includes("id = $1")) return { rows: [lead] };
      if (sql.includes("INSERT INTO clients")) {
        expect(params[0]).toBe("Jeanne Tremblay");
        expect(params[4]).toBeNull();
        return { rows: [createdClient] };
      }
      if (sql.includes("UPDATE sales_leads")) {
        return { rows: [{ ...lead, status: "converted", converted_client_id: 45 }] };
      }
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    const result = await convertLeadToClient({
      leadId: 12,
      organisationId: 7,
      idempotencyKey: "conversion-personne",
    });

    expect(result.client).toEqual(createdClient);
  });

  test("retourne le résultat existant lors d'une répétition avec la même clé", async () => {
    const lead = qualifiedLead({
      status: "converted",
      converted_client_id: 44,
      conversion_idempotency_key: "conversion-12",
    });
    const existingClient = { id: 44, nom: "Atelier Tremblay", organisation_id: 7 };

    const tx = createTxClient(async (sql) => {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2") && sql.includes("SELECT")) return { rows: [lead] };
      if (sql.includes("FROM clients")) return { rows: [existingClient] };
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    const result = await convertLeadToClient({
      leadId: 12,
      organisationId: 7,
      idempotencyKey: "conversion-12",
    });

    expect(result).toEqual({ lead, client: existingClient, idempotent: true });
    expect(tx.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO clients"))).toBe(false);
  });

  test("retourne null et annule la transaction quand le prospect est introuvable", async () => {
    const tx = createTxClient(async (sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2")) return { rows: [] };
      if (sql.includes("FROM sales_leads")) return { rows: [] };
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    await expect(convertLeadToClient({
      leadId: 999,
      organisationId: 7,
      idempotencyKey: "conversion-999",
    })).resolves.toBeNull();

    expect(tx.query).toHaveBeenCalledWith("ROLLBACK");
    expect(tx.release).toHaveBeenCalledTimes(1);
  });

  test("refuse un prospect qui n'est pas qualifié sans créer de client", async () => {
    const tx = createTxClient(async (sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2")) return { rows: [] };
      if (sql.includes("FROM sales_leads")) return { rows: [qualifiedLead({ status: "contacted" })] };
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    await expect(convertLeadToClient({
      leadId: 12,
      organisationId: 7,
      idempotencyKey: "conversion-12",
    })).rejects.toMatchObject({ code: "LEAD_NOT_QUALIFIED", statusCode: 409 });

    expect(tx.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO clients"))).toBe(false);
    expect(tx.query).toHaveBeenCalledWith("ROLLBACK");
  });

  test("refuse un prospect déjà converti avec une autre clé", async () => {
    const converted = qualifiedLead({
      status: "converted",
      converted_client_id: 44,
      conversion_idempotency_key: "ancienne-cle",
    });
    const tx = createTxClient(async (sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2")) return { rows: [] };
      if (sql.includes("FROM sales_leads")) return { rows: [converted] };
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    await expect(convertLeadToClient({
      leadId: 12,
      organisationId: 7,
      idempotencyKey: "nouvelle-cle",
    })).rejects.toMatchObject({ code: "LEAD_ALREADY_CONVERTED", statusCode: 409 });
  });

  test("refuse la réutilisation d'une clé par un autre prospect", async () => {
    const tx = createTxClient(async (sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2")) {
        return { rows: [qualifiedLead({ id: 99, status: "converted", converted_client_id: 55 })] };
      }
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    await expect(convertLeadToClient({
      leadId: 12,
      organisationId: 7,
      idempotencyKey: "cle-partagee",
    })).rejects.toMatchObject({ code: "LEAD_CONVERSION_KEY_REUSED", statusCode: 409 });
  });

  test("annule toute la conversion si la création du client échoue", async () => {
    const failure = new Error("écriture client impossible");
    const tx = createTxClient(async (sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("conversion_idempotency_key = $2")) return { rows: [] };
      if (sql.includes("FROM sales_leads")) return { rows: [qualifiedLead()] };
      if (sql.includes("INSERT INTO clients")) throw failure;
      throw new Error(`Requête inattendue: ${sql}`);
    });
    db.connect.mockResolvedValue(tx);

    await expect(convertLeadToClient({
      leadId: 12,
      organisationId: 7,
      idempotencyKey: "conversion-12",
    })).rejects.toBe(failure);

    expect(tx.query).toHaveBeenCalledWith("ROLLBACK");
    expect(tx.query.mock.calls.some(([sql]) => sql.includes("UPDATE sales_leads"))).toBe(false);
    expect(tx.release).toHaveBeenCalledTimes(1);
  });
});
