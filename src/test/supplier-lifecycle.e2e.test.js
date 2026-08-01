// Preuve d'exécution réelle pour le domaine 2 (fournisseurs et achats),
// premier micro-bloc. Cartographie préalable : le flux registre → facture
// → approbation → paiement → renversement est déjà entièrement câblé
// (suppliers.routes.js, supplier-bill-lifecycle.service.js,
// supplier-payment.service.js, payment-reversal.service.js) et
// comptabilisé via accounting-sync.service.js, mais AUCUN test dans
// src/test/ ne l'exécute réellement contre PostgreSQL — uniquement des
// mocks intégraux de la base ou des fonctions pures testées hors DB. Ce
// test exécute le flux complet via de vraies requêtes HTTP (supertest)
// contre une vraie base, et vérifie les écritures comptables réellement
// publiées.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { seedDefaultChart } = require("../services/business/accounting.service");

const mockState = { organisationId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  if (role) req.user = { id: 1, role };
  next();
}

const suppliersRoutes = require("../routes/business/suppliers.routes");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(fakeAuth);
  app.use("/api/suppliers", suppliersRoutes);
  return app;
}

async function entryTotals(entryId) {
  const { rows } = await db.pool.query(
    "SELECT COALESCE(SUM(debit),0)::numeric AS debit, COALESCE(SUM(credit),0)::numeric AS credit FROM accounting_entry_lines WHERE entry_id=$1",
    [entryId],
  );
  return { debit: Number(rows[0].debit), credit: Number(rows[0].credit) };
}

describe("Cycle fournisseur complet — registre, facture, paiement (domaine 2)", () => {
  let app;
  let orgId;
  let supplierId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Fournisseurs E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    await seedDefaultChart(db.pool, orgId);
    app = buildApp();
  });

  test("un employé ne peut pas créer de fournisseur ni de facture (lecture seule)", async () => {
    const createSupplier = await request(app)
      .post("/api/suppliers")
      .set("x-test-role", "employe")
      .send({ name: "Fournisseur test" });
    expect(createSupplier.status).toBe(403);

    const list = await request(app).get("/api/suppliers").set("x-test-role", "employe");
    expect(list.status).toBe(200);
    expect(list.body.suppliers).toEqual([]);
  });

  test("registre : créer un fournisseur", async () => {
    const res = await request(app)
      .post("/api/suppliers")
      .set("x-test-role", "admin")
      .send({ name: "Atelier Mécanique Boréal", contactName: "J. Tremblay", email: "achats@boreal.example", paymentTermsDays: 30 });
    expect(res.status).toBe(201);
    expect(res.body.supplier.name).toBe("Atelier Mécanique Boréal");
    supplierId = res.body.supplier.id;
  });

  test("facture fournisseur : création (brouillon), approbation avec écriture comptable réellement équilibrée", async () => {
    const created = await request(app)
      .post("/api/suppliers/bills")
      .set("x-test-role", "admin")
      .send({ supplierId, billNumber: "FRS-0001", billDate: "2026-05-01", dueDate: "2026-05-31", subtotal: 1000, taxTotal: 50 });
    expect(created.status).toBe(201);
    expect(created.body.bill.status).toBe("draft");
    expect(Number(created.body.bill.total)).toBe(1050);
    const billId = created.body.bill.id;

    const approveByEmployee = await request(app)
      .post(`/api/suppliers/bills/${billId}/approve`)
      .set("x-test-role", "employe");
    expect(approveByEmployee.status).toBe(403);

    const approved = await request(app)
      .post(`/api/suppliers/bills/${billId}/approve`)
      .set("x-test-role", "admin");
    expect(approved.status).toBe(201);
    expect(approved.body.bill.status).toBe("approved");
    expect(approved.body.accounting.entryId).toBeTruthy();

    const totals = await entryTotals(approved.body.accounting.entryId);
    expect(totals.debit).toBeCloseTo(totals.credit, 2);
    expect(totals.debit).toBeCloseTo(1050, 2);

    // Réapprouver est idempotent : même écriture, pas de doublon.
    const reapproved = await request(app)
      .post(`/api/suppliers/bills/${billId}/approve`)
      .set("x-test-role", "admin");
    expect(reapproved.status).toBe(200);
    expect(reapproved.body.accountingEntryId).toBe(approved.body.accounting.entryId);
  });

  test("paiement fournisseur : écriture comptable réelle, solde restant correct, renversement", async () => {
    const bills = await request(app).get("/api/suppliers/bills").set("x-test-role", "admin");
    const bill = bills.body.bills.find((row) => row.bill_number === "FRS-0001");
    expect(Number(bill.balance_due)).toBe(1050);

    const partialPayment = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/payments`)
      .set("x-test-role", "admin")
      .send({ amount: 600, paidAt: "2026-05-10", paymentMethod: "wire", reference: "VIR-001", idempotencyKey: "supplier-pay-e2e-0001" });
    expect(partialPayment.status).toBe(201);
    expect(partialPayment.body.status).toBe("partially_paid");
    const paymentTotals = await entryTotals(partialPayment.body.payment.accounting_entry_id);
    expect(paymentTotals.debit).toBeCloseTo(paymentTotals.credit, 2);
    expect(paymentTotals.debit).toBeCloseTo(600, 2);

    const billsAfterPartial = await request(app).get("/api/suppliers/bills").set("x-test-role", "admin");
    const billAfterPartial = billsAfterPartial.body.bills.find((row) => row.bill_number === "FRS-0001");
    expect(Number(billAfterPartial.balance_due)).toBe(450);
    expect(billAfterPartial.status).toBe("partially_paid");

    // Payer le solde exact ferme la facture.
    const finalPayment = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/payments`)
      .set("x-test-role", "admin")
      .send({ amount: 450, paidAt: "2026-05-20", paymentMethod: "wire", reference: "VIR-002", idempotencyKey: "supplier-pay-e2e-0002" });
    expect(finalPayment.status).toBe(201);
    expect(finalPayment.body.status).toBe("paid");

    // Un paiement qui dépasserait le solde restant est refusé.
    const overpay = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/payments`)
      .set("x-test-role", "admin")
      .send({ amount: 1, paidAt: "2026-05-21", idempotencyKey: "supplier-pay-e2e-overpay" });
    expect(overpay.status).toBe(409);

    // Renverser le paiement final rouvre la facture.
    const employeeReversal = await request(app)
      .post(`/api/suppliers/payments/${finalPayment.body.payment.id}/reverse`)
      .set("x-test-role", "employe")
      .send({ reason: "Test de permission" });
    expect(employeeReversal.status).toBe(403);

    const reversal = await request(app)
      .post(`/api/suppliers/payments/${finalPayment.body.payment.id}/reverse`)
      .set("x-test-role", "admin")
      .send({ reason: "Paiement en double détecté après coup", idempotencyKey: "supplier-pay-reverse-e2e-0001" });
    expect(reversal.status).toBe(201);

    const billsAfterReversal = await request(app).get("/api/suppliers/bills").set("x-test-role", "admin");
    const billAfterReversal = billsAfterReversal.body.bills.find((row) => row.bill_number === "FRS-0001");
    expect(Number(billAfterReversal.balance_due)).toBe(450);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "Fournisseurs E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const list = await request(app).get("/api/suppliers").set("x-test-role", "admin");
      expect(list.body.suppliers).toEqual([]);

      const bills = await request(app).get("/api/suppliers/bills").set("x-test-role", "admin");
      expect(bills.body.bills).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
