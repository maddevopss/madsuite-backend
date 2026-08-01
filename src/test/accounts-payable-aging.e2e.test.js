// Preuve d'exécution réelle du rapport de vieillissement des comptes
// fournisseurs (AP aging). Cartographie préalable : deux moteurs existants
// (payablesSchedule.service.js, supplier-payment-forecast.service.js) sont
// du code totalement orphelin (aucune route, aucun test, ni l'un ni
// l'autre ne fait de regroupement par tranches d'ancienneté), et le moteur
// d'aging le plus proche (accountsReceivableAging.service.js) opère sur des
// tableaux déjà en mémoire, jamais branché sur une requête SQL réelle. Ce
// bloc ajoute un vrai calcul d'aging fournisseur adossé à supplier_bills /
// supplier_payments / supplier_credit_notes, exposé via une route HTTP, et
// le vérifie contre une vraie base PostgreSQL — bornes de tranches, filtre
// fournisseur, exclusion des factures brouillon/annulées/entièrement
// payées, et isolation entre organisations.
const express = require("express");
const request = require("supertest");
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");

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

const ASOF = "2026-06-30";

function daysBeforeAsOf(n) {
  const d = new Date(`${ASOF}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function insertSupplier(client, organisationId, { supplierNumber, name }) {
  const { rows } = await client.query(
    `INSERT INTO suppliers (organisation_id, supplier_number, name) VALUES ($1,$2,$3) RETURNING id`,
    [organisationId, supplierNumber, name],
  );
  return rows[0].id;
}

async function insertBill(client, organisationId, { supplierId, billNumber, dueDate, total, status = "approved" }) {
  const { rows } = await client.query(
    `INSERT INTO supplier_bills (organisation_id, supplier_id, bill_number, bill_date, due_date, subtotal, tax_total, total, status)
     VALUES ($1,$2,$3,$4,$5,$6,0,$6,$7) RETURNING id`,
    [organisationId, supplierId, billNumber, dueDate, dueDate, total, status],
  );
  return rows[0].id;
}

async function insertPayment(client, organisationId, { billId, amount, idempotencyKey }) {
  await client.query(
    `INSERT INTO supplier_payments (organisation_id, supplier_bill_id, amount, idempotency_key)
     VALUES ($1,$2,$3,$4)`,
    [organisationId, billId, amount, idempotencyKey],
  );
}

async function insertCreditNote(client, organisationId, { billId, supplierId, creditNumber, total }) {
  await client.query(
    `INSERT INTO supplier_credit_notes (organisation_id, supplier_bill_id, supplier_id, credit_number, subtotal, tax_total, total, reason, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,0,$5,'Ajustement de test',$6)`,
    [organisationId, billId, supplierId, creditNumber, total, `idem-${creditNumber}`],
  );
}

describe("Vieillissement des comptes fournisseurs — AP aging (domaine 2)", () => {
  let app;
  let orgId;
  let supplierAId;
  let supplierBId;

  beforeAll(async () => {
    const org = await createTestOrganisation({ nom: "AP Aging E2E Org" });
    orgId = org.id;
    mockState.organisationId = orgId;
    app = buildApp();

    supplierAId = await insertSupplier(db.pool, orgId, { supplierNumber: "SUP-AGING-A", name: "Fournisseur A" });
    supplierBId = await insertSupplier(db.pool, orgId, { supplierNumber: "SUP-AGING-B", name: "Fournisseur B" });

    // current : échéance future, pas encore en retard.
    await insertBill(db.pool, orgId, { supplierId: supplierAId, billNumber: "AGE-CURRENT", dueDate: daysBeforeAsOf(-15), total: 100 });
    // 1_30 : 15 jours de retard.
    await insertBill(db.pool, orgId, { supplierId: supplierAId, billNumber: "AGE-1-30", dueDate: daysBeforeAsOf(15), total: 200 });
    // 31_60 : 45 jours de retard, payée partiellement (solde réduit).
    const partialBillId = await insertBill(db.pool, orgId, { supplierId: supplierAId, billNumber: "AGE-31-60", dueDate: daysBeforeAsOf(45), total: 500, status: "partially_paid" });
    await insertPayment(db.pool, orgId, { billId: partialBillId, amount: 300, idempotencyKey: "pay-31-60" });
    // 61_90 : 75 jours de retard, chez le fournisseur B, réduite par une note de crédit.
    const creditedBillId = await insertBill(db.pool, orgId, { supplierId: supplierBId, billNumber: "AGE-61-90", dueDate: daysBeforeAsOf(75), total: 400 });
    await insertCreditNote(db.pool, orgId, { billId: creditedBillId, supplierId: supplierBId, creditNumber: "NCF-AGING-1", total: 150 });
    // over_90 : 120 jours de retard.
    await insertBill(db.pool, orgId, { supplierId: supplierBId, billNumber: "AGE-OVER-90", dueDate: daysBeforeAsOf(120), total: 1000 });

    // Ne doivent PAS apparaître dans le rapport :
    await insertBill(db.pool, orgId, { supplierId: supplierAId, billNumber: "AGE-DRAFT", dueDate: daysBeforeAsOf(200), total: 999, status: "draft" });
    await insertBill(db.pool, orgId, { supplierId: supplierAId, billNumber: "AGE-VOID", dueDate: daysBeforeAsOf(200), total: 999, status: "void" });
    const paidBillId = await insertBill(db.pool, orgId, { supplierId: supplierAId, billNumber: "AGE-PAID", dueDate: daysBeforeAsOf(10), total: 250, status: "paid" });
    await insertPayment(db.pool, orgId, { billId: paidBillId, amount: 250, idempotencyKey: "pay-full" });
  });

  test("date de référence invalide : 400", async () => {
    const res = await request(app).get("/api/suppliers/aging").query({ asOf: "pas-une-date" }).set("x-test-role", "employe");
    expect(res.status).toBe(400);
  });

  test("lecture seule accessible à un employé, totaux par tranche corrects", async () => {
    const res = await request(app).get("/api/suppliers/aging").query({ asOf: ASOF }).set("x-test-role", "employe");
    expect(res.status).toBe(200);
    expect(res.body.asOf).toBe(ASOF);
    expect(res.body.totals).toEqual({
      current: 100,
      "1_30": 200,
      "31_60": 200, // 500 - 300 payé
      "61_90": 250, // 400 - 150 crédité
      over_90: 1000,
    });
    expect(res.body.totalDue).toBe(1750);

    // Les factures brouillon, annulée et intégralement payée sont exclues.
    const billNumbers = res.body.rows.map((row) => row.billNumber);
    expect(billNumbers).not.toContain("AGE-DRAFT");
    expect(billNumbers).not.toContain("AGE-VOID");
    expect(billNumbers).not.toContain("AGE-PAID");
    expect(billNumbers).toHaveLength(5);

    const partial = res.body.rows.find((row) => row.billNumber === "AGE-31-60");
    expect(partial.balanceDue).toBe(200);
    expect(partial.bucket).toBe("31_60");
    expect(partial.daysPastDue).toBe(45);

    const credited = res.body.rows.find((row) => row.billNumber === "AGE-61-90");
    expect(credited.balanceDue).toBe(250);
    expect(credited.bucket).toBe("61_90");
  });

  test("regroupement par fournisseur", async () => {
    const res = await request(app).get("/api/suppliers/aging").query({ asOf: ASOF }).set("x-test-role", "employe");
    const supplierA = res.body.bySupplier.find((row) => row.supplierId === supplierAId);
    const supplierB = res.body.bySupplier.find((row) => row.supplierId === supplierBId);
    expect(supplierA.totalDue).toBe(500); // 100 + 200 + 200
    expect(supplierB.totalDue).toBe(1250); // 250 + 1000
  });

  test("filtre par fournisseur", async () => {
    const res = await request(app).get("/api/suppliers/aging").query({ asOf: ASOF, supplierId: supplierBId }).set("x-test-role", "employe");
    expect(res.body.totalDue).toBe(1250);
    expect(res.body.rows.every((row) => row.supplierId === supplierBId)).toBe(true);
  });

  test("isolation stricte entre deux organisations", async () => {
    const otherOrg = await createTestOrganisation({ nom: "AP Aging E2E Org B" });
    const previousOrg = mockState.organisationId;
    mockState.organisationId = otherOrg.id;
    try {
      const res = await request(app).get("/api/suppliers/aging").query({ asOf: ASOF }).set("x-test-role", "employe");
      expect(res.body.totalDue).toBe(0);
      expect(res.body.rows).toEqual([]);
    } finally {
      mockState.organisationId = previousOrg;
    }
  });
});
