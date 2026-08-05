// Suite du domaine 2 (fournisseurs et achats). #687 a prouvé par un vrai
// test HTTP+DB le cycle registre → facture → approbation → paiement →
// renversement, et a corrigé au passage le déclencheur d'immuabilité pour
// autoriser explicitement l'annulation de facture (voidSupplierBill,
// POST /bills/:id/void) — mais cette capacité elle-même n'était couverte
// par AUCUN test, ni réel ni mocké (vérifié par grep exhaustif avant
// d'écrire ce fichier). Ce test exécute l'annulation via de vraies
// requêtes HTTP contre une vraie base : garde-fous (raison obligatoire,
// statut éligible, paiements actifs à renverser d'abord), écriture
// comptable de renversement réellement équilibrée, idempotence, et
// isolation multi-organisation.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation, createTestUser } = require("./helpers/testData");
const { seedDefaultChart } = require("../services/business/accounting.service");

const mockState = { organisationId: null, userId: null };

jest.mock("../middleware/organization.middleware", () => ({
  requireOrganisation: (req, _res, next) => {
    req.organisationId = mockState.organisationId;
    req.db = require("../../db");
    next();
  },
}));

function fakeAuth(req, _res, next) {
  const role = req.header("x-test-role");
  if (role) req.user = { id: mockState.userId, role };
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

async function createSupplierAndBill(app, { billNumber, subtotal = 1000, taxTotal = 50 }) {
  const supplier = await request(app)
    .post("/api/suppliers")
    .set("x-test-role", "admin")
    .send({ name: `Fournisseur ${billNumber}` });
  const bill = await request(app)
    .post("/api/suppliers/bills")
    .set("x-test-role", "admin")
    .send({ supplierId: supplier.body.supplier.id, billNumber, billDate: "2026-05-01", dueDate: "2026-05-31", subtotal, taxTotal });
  return bill.body.bill;
}

describe("Annulation de facture fournisseur — voidSupplierBill (suite #687)", () => {
  let app;
  let orgId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "Fournisseurs Void E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    const user = await createTestUser({ organisation_id: orgId, role: "admin" });
    mockState.userId = user.id;
    await seedDefaultChart(db.pool, orgId);
    app = buildApp();
  });

  test("un employé ne peut pas annuler une facture", async () => {
    const bill = await createSupplierAndBill(app, { billNumber: "FRS-VOID-ROLE" });
    const attempt = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "employe")
      .send({ reason: "Test", idempotencyKey: "void-role-0001" });
    expect(attempt.status).toBe(403);
  });

  test("une facture en brouillon (non approuvée) ne peut pas être annulée", async () => {
    const bill = await createSupplierAndBill(app, { billNumber: "FRS-VOID-DRAFT" });
    const attempt = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "admin")
      .send({ reason: "Erreur de saisie", idempotencyKey: "void-draft-0001" });
    expect(attempt.status).toBe(409);
  });

  test("la raison est obligatoire", async () => {
    const bill = await createSupplierAndBill(app, { billNumber: "FRS-VOID-NOREASON" });
    await request(app).post(`/api/suppliers/bills/${bill.id}/approve`).set("x-test-role", "admin");
    const attempt = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "admin")
      .send({ idempotencyKey: "void-noreason-0001" });
    expect(attempt.status).toBe(400);
  });

  test("annuler une facture approuvée (sans paiement) publie une écriture de renversement réellement équilibrée", async () => {
    const bill = await createSupplierAndBill(app, { billNumber: "FRS-VOID-APPROVED", subtotal: 1000, taxTotal: 50 });
    const approved = await request(app).post(`/api/suppliers/bills/${bill.id}/approve`).set("x-test-role", "admin");
    const originalEntryId = approved.body.accounting.entryId;
    const originalTotals = await entryTotals(originalEntryId);

    const voided = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "admin")
      .send({ reason: "Facture émise par erreur", idempotencyKey: "void-approved-0001" });
    expect(voided.status).toBe(201);
    expect(voided.body.bill.status).toBe("void");
    expect(voided.body.accounting.entryId).toBeTruthy();
    expect(voided.body.accounting.entryId).not.toBe(originalEntryId);

    const reversalTotals = await entryTotals(voided.body.accounting.entryId);
    expect(reversalTotals.debit).toBeCloseTo(reversalTotals.credit, 2);
    expect(reversalTotals.debit).toBeCloseTo(originalTotals.debit, 2);

    // Idempotence : même clé, même résultat, aucune deuxième écriture créée.
    const replay = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "admin")
      .send({ reason: "Facture émise par erreur", idempotencyKey: "void-approved-0001" });
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);

    // Une deuxième tentative avec une clé différente sur une facture déjà annulée est refusée.
    const secondVoid = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "admin")
      .send({ reason: "Autre raison", idempotencyKey: "void-approved-0002" });
    expect(secondVoid.status).toBe(409);
  });

  test("une facture avec un paiement actif ne peut pas être annulée avant renversement du paiement", async () => {
    const bill = await createSupplierAndBill(app, { billNumber: "FRS-VOID-PAID", subtotal: 500, taxTotal: 0 });
    await request(app).post(`/api/suppliers/bills/${bill.id}/approve`).set("x-test-role", "admin");
    const payment = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/payments`)
      .set("x-test-role", "admin")
      .send({ amount: 500, paidAt: "2026-05-10", paymentMethod: "wire", reference: "VIR-VOID-01", idempotencyKey: "void-paid-pay-0001" });
    expect(payment.status).toBe(201);
    expect(payment.body.status).toBe("paid");

    const blockedVoid = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "admin")
      .send({ reason: "Tentative avec paiement actif", idempotencyKey: "void-paid-0001" });
    expect(blockedVoid.status).toBe(409);

    const reversal = await request(app)
      .post(`/api/suppliers/payments/${payment.body.payment.id}/reverse`)
      .set("x-test-role", "admin")
      .send({ reason: "Renversement pour permettre l’annulation", idempotencyKey: "void-paid-reverse-0001" });
    expect(reversal.status).toBe(201);

    const voidAfterReversal = await request(app)
      .post(`/api/suppliers/bills/${bill.id}/void`)
      .set("x-test-role", "admin")
      .send({ reason: "Facture annulée après renversement du paiement", idempotencyKey: "void-paid-0002" });
    expect(voidAfterReversal.status).toBe(201);
    expect(voidAfterReversal.body.bill.status).toBe("void");
  });

  test("isolation stricte : une facture d'une organisation est introuvable (404) depuis une autre", async () => {
    const bill = await createSupplierAndBill(app, { billNumber: "FRS-VOID-ISO" });
    await request(app).post(`/api/suppliers/bills/${bill.id}/approve`).set("x-test-role", "admin");

    const otherOrg = await createTestOrganisation({ nom: "Fournisseurs Void E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const crossOrgVoid = await request(app)
        .post(`/api/suppliers/bills/${bill.id}/void`)
        .set("x-test-role", "admin")
        .send({ reason: "Tentative inter-organisation", idempotencyKey: "void-iso-0001" });
      expect(crossOrgVoid.status).toBe(404);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
