const request = require("supertest");
const express = require("express");
const db = require("../../db");
const quoteConversionService = require("../services/quoteConversion.service");

const { requireOrganisation } = require("../middleware/organization.middleware");
const { getOrganisationId } = require("../utils/organisationScope");
const { handleServiceError } = require("../utils/routeError");
const ApiResponse = require("../utils/apiResponse");

jest.mock("../../db", () => {
  const queryMock = jest.fn();
  const mockClient = {
    query: queryMock,
    release: jest.fn()
  };
  return {
    query: queryMock,
    pool: { 
      connect: jest.fn().mockResolvedValue(mockClient)
    }
  };
});

jest.mock("../services/quoteConversion.service", () => ({
  convertQuoteToInvoice: jest.fn()
}));

const quotesRoutes = require("../routes/quotes.routes");

function setupApp(user) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use("/api/quotes", quotesRoutes);
  return app;
}

describe("Quote Conversion", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("POST /api/quotes/:id/convert", () => {
    it("devrait retourner 201 et l'invoice creee", async () => {
      const app = setupApp({ id: 1, role: "admin", organisation_id: 1 });
      
      quoteConversionService.convertQuoteToInvoice.mockResolvedValueOnce({
        id: 100,
        invoice_number: "INV-100",
        client_id: 2,
        total: "500.00",
        status: "draft"
      });

      db.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });

      const res = await request(app).post("/api/quotes/5/convert");
      
      if (res.statusCode !== 201) {
        console.log(res.body);
      }     
      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(100);
      
      expect(quoteConversionService.convertQuoteToInvoice).toHaveBeenCalledWith(expect.objectContaining({
        quoteId: 5,
        organisationId: 1
      }));
    });

    it("devrait rejeter si l'utilisateur n'est pas admin", async () => {
      const app = setupApp({ id: 2, role: "employe", organisation_id: 1 });
      const res = await request(app).post("/api/quotes/5/convert");
      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});

