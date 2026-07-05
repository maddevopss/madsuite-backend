const request = require("supertest");
const express = require("express");

jest.mock("../../db", () => {
  const queryMock = jest.fn();
  const releaseMock = jest.fn();

  const mockClient = {
    query: queryMock,
    release: releaseMock,
  };

  return {
    query: queryMock,
    pool: {
      connect: jest.fn().mockResolvedValue(mockClient),
    },
    getClient: jest.fn().mockResolvedValue(mockClient),
    __mockClient: mockClient,
    __releaseMock: releaseMock,
  };
});

jest.mock("../services/quoteConversion.service", () => ({
  convertQuoteToInvoice: jest.fn(),
}));

const db = require("../../db");
const quoteConversionService = require("../services/quoteConversion.service");
const quotesRoutes = require("../routes/quotes.routes");

function setupApp(user = { id: 1, role: "admin", organisation_id: 1 }) {
  const app = express();

  app.use(express.json());

  app.locals.db = db;

  app.use((req, res, next) => {
    req.user = user;
    req.db = db.__mockClient;
    req.organisationId = user.organisation_id;
    next();
  });

  app.use("/api/quotes", quotesRoutes);

  app.use((err, req, res, next) => {
    console.error("QUOTE TEST ERROR:", err);

    res.status(err.status || err.statusCode || 500).json({
      success: false,
      message: err.message,
    });
  });

  return app;
}

describe("Quote Conversion", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    db.query.mockResolvedValue({ rowCount: 1, rows: [] });
    db.__mockClient.query.mockResolvedValue({ rowCount: 1, rows: [] });

    db.pool.connect.mockResolvedValue(db.__mockClient);
    db.getClient.mockResolvedValue(db.__mockClient);
  });

  describe("POST /api/quotes/:id/convert", () => {
    it("devrait retourner 201 et l'invoice creee", async () => {
      const app = setupApp({ id: 1, role: "admin", organisation_id: 1 });

      const invoice = {
        id: 100,
        invoice_number: "INV-100",
        client_id: 2,
        total: "500.00",
        status: "draft",
      };

      quoteConversionService.convertQuoteToInvoice.mockResolvedValueOnce(invoice);

      const res = await request(app).post("/api/quotes/5/convert");

      if (res.statusCode !== 201) {
        console.log(res.body);
      }

      expect(res.statusCode).toBe(201);

      const returnedInvoice = res.body.data || res.body.invoice || res.body;

      expect(returnedInvoice.id).toBe(100);

      expect(quoteConversionService.convertQuoteToInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteId: 5,
          organisationId: 1,
        }),
      );
    });

it("devrait rejeter si l'utilisateur n'est pas admin", async () => {
  const app = setupApp({ id: 2, role: "employe", organisation_id: 1 });

  const res = await request(app).post("/api/quotes/5/convert");

  if (res.statusCode !== 403) {
    console.log(res.body);
  }

  expect(res.statusCode).toBe(403);
  expect(quoteConversionService.convertQuoteToInvoice).not.toHaveBeenCalled();
});
  });
});