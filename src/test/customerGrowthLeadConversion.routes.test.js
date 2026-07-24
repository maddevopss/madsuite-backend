const express = require("express");
const request = require("supertest");

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, res, next) => next(),
}));

jest.mock("../middleware/requireRole", () => () => (req, res, next) => {
  if (req.headers["x-test-role"] !== "admin") {
    return res.status(403).json({ success: false, code: "FORBIDDEN" });
  }
  req.user = { id: 91 };
  return next();
});

jest.mock("../utils/organisationScope", () => ({
  getOrganisationId: () => 77,
}));

jest.mock("../services/customerGrowth/leads.service", () => ({
  createLead: jest.fn(),
  deleteLead: jest.fn(),
  getLeadById: jest.fn(),
  listLeads: jest.fn(),
  updateLead: jest.fn(),
}));

jest.mock("../services/customerGrowth/leadConversion.service", () => ({
  convertLeadToClient: jest.fn(),
}));

const { convertLeadToClient } = require("../services/customerGrowth/leadConversion.service");
const leadsRouter = require("../routes/customerGrowth/leads.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/leads", leadsRouter);
  app.use((error, req, res, next) => {
    void req;
    void next;
    return res.status(error.statusCode || 500).json({
      code: error.code,
      message: error.message,
    });
  });
  return app;
}

describe("customer growth lead conversion route", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("refuse une conversion sans rôle admin avant le service", async () => {
    const response = await request(buildApp())
      .post("/leads/4/convert")
      .send({ idempotency_key: "lead-4-conversion" });

    expect(response.status).toBe(403);
    expect(convertLeadToClient).not.toHaveBeenCalled();
  });

  test("refuse une clé d'idempotence absente", async () => {
    const response = await request(buildApp())
      .post("/leads/4/convert")
      .set("x-test-role", "admin")
      .send({});

    expect(response.status).toBe(400);
    expect(convertLeadToClient).not.toHaveBeenCalled();
  });

  test("refuse les champs publics inconnus dont organisation_id", async () => {
    const response = await request(buildApp())
      .post("/leads/4/convert")
      .set("x-test-role", "admin")
      .send({ idempotency_key: "lead-4-conversion", organisation_id: 999 });

    expect(response.status).toBe(400);
    expect(convertLeadToClient).not.toHaveBeenCalled();
  });

  test("refuse un identifiant de prospect invalide", async () => {
    const response = await request(buildApp())
      .post("/leads/invalide/convert")
      .set("x-test-role", "admin")
      .send({ idempotency_key: "lead-conversion" });

    expect(response.status).toBe(400);
    expect(convertLeadToClient).not.toHaveBeenCalled();
  });

  test("convertit avec l'organisation du contexte serveur", async () => {
    convertLeadToClient.mockResolvedValue({
      lead: { id: 4, status: "converted", converted_client_id: 22 },
      client: { id: 22, nom: "Entreprise Test" },
      idempotent: false,
    });

    const response = await request(buildApp())
      .post("/leads/4/convert")
      .set("x-test-role", "admin")
      .send({ idempotency_key: " lead-4-conversion " });

    expect(response.status).toBe(201);
    expect(convertLeadToClient).toHaveBeenCalledTimes(1);
    expect(convertLeadToClient).toHaveBeenCalledWith({
      leadId: 4,
      organisationId: 77,
      idempotencyKey: "lead-4-conversion",
    });
    expect(response.body).toMatchObject({
      lead: { id: 4 },
      client: { id: 22 },
      idempotent: false,
    });
  });

  test("retourne 200 lors d'une répétition idempotente", async () => {
    convertLeadToClient.mockResolvedValue({
      lead: { id: 4, status: "converted", converted_client_id: 22 },
      client: { id: 22, nom: "Entreprise Test" },
      idempotent: true,
    });

    const response = await request(buildApp())
      .post("/leads/4/convert")
      .set("x-test-role", "admin")
      .send({ idempotency_key: "lead-4-conversion" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      lead: { id: 4 },
      client: { id: 22 },
      idempotent: true,
    });
  });

  test("retourne 404 lorsque le prospect n'existe pas", async () => {
    convertLeadToClient.mockResolvedValue(null);

    const response = await request(buildApp())
      .post("/leads/44/convert")
      .set("x-test-role", "admin")
      .send({ idempotency_key: "lead-44-conversion" });

    expect(response.status).toBe(404);
    expect(convertLeadToClient).toHaveBeenCalledWith({
      leadId: 44,
      organisationId: 77,
      idempotencyKey: "lead-44-conversion",
    });
    expect(response.body).toMatchObject({
      message: "Prospect introuvable.",
    });
  });

  test("propage un conflit métier du service", async () => {
    const error = new Error("Seul un prospect qualifié peut être converti en client.");
    error.statusCode = 409;
    error.code = "LEAD_NOT_QUALIFIED";
    convertLeadToClient.mockRejectedValue(error);

    const response = await request(buildApp())
      .post("/leads/4/convert")
      .set("x-test-role", "admin")
      .send({ idempotency_key: "lead-4-conversion" });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain("prospect qualifié");
    expect(response.body.code).toBe("LEAD_NOT_QUALIFIED");
  });
});
