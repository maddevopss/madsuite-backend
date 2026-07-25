const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const accountingPostingService = require("../../services/business/accounting-posting.service");
const supplierPaymentService = require("../../services/business/supplier-payment.service");
const paymentReversalService = require("../../services/business/payment-reversal.service");
const supplierBillLifecycleService = require("../../services/business/supplier-bill-lifecycle.service");

router.use(requireOrganisation);

router.get("/", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      "SELECT * FROM suppliers WHERE organisation_id = $1 ORDER BY name",
      [req.organisationId],
    );
    res.json({ suppliers: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/", requireRole("admin"), async (req, res, next) => {
  try {
    const body = req.body;
    const { rows } = await req.db.query(
      `INSERT INTO suppliers
       (organisation_id, name, contact_name, email, phone, tax_number, payment_terms_days, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.organisationId,
        body.name,
        body.contactName || null,
        body.email || null,
        body.phone || null,
        body.taxNumber || null,
        body.paymentTermsDays || 30,
        body.address || {},
      ],
    );
    res.status(201).json({ supplier: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/bills", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT b.*, s.name supplier_name,
              COALESCE(SUM(p.amount) FILTER (WHERE p.reversed_at IS NULL), 0) paid_total,
              COALESCE((SELECT SUM(c.total) FROM supplier_credit_notes c
                        WHERE c.organisation_id = b.organisation_id AND c.supplier_bill_id = b.id), 0) credited_total,
              GREATEST(0, b.total
                - COALESCE(SUM(p.amount) FILTER (WHERE p.reversed_at IS NULL), 0)
                - COALESCE((SELECT SUM(c.total) FROM supplier_credit_notes c
                            WHERE c.organisation_id = b.organisation_id AND c.supplier_bill_id = b.id), 0)) balance_due
       FROM supplier_bills b
       JOIN suppliers s ON s.id = b.supplier_id
       LEFT JOIN supplier_payments p ON p.supplier_bill_id = b.id AND p.organisation_id = b.organisation_id
       WHERE b.organisation_id = $1
       GROUP BY b.id, s.name
       ORDER BY b.bill_date DESC`,
      [req.organisationId],
    );
    res.json({ bills: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/bills", requireRole("admin"), async (req, res, next) => {
  try {
    const body = req.body;
    const subtotal = Number(body.subtotal || 0);
    const taxTotal = Number(body.taxTotal || 0);
    if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(taxTotal) || taxTotal < 0) {
      return res.status(400).json({ message: "Montants de facture fournisseur invalides." });
    }
    const total = Number((subtotal + taxTotal).toFixed(2));
    const { rows } = await req.db.query(
      `INSERT INTO supplier_bills
       (organisation_id, supplier_id, bill_number, bill_date, due_date, subtotal, tax_total, total, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft')
       RETURNING *`,
      [req.organisationId, body.supplierId, body.billNumber, body.billDate, body.dueDate || null, subtotal, taxTotal, total],
    );
    return res.status(201).json({ bill: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post("/bills/:id/approve", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await accountingPostingService.approveSupplierBill({
      billId: req.params.id,
      organisationId: req.organisationId,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json({ message: "Facture fournisseur introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/bills/:id/credit-notes", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await supplierBillLifecycleService.postSupplierCreditNote({
      billId: req.params.id,
      organisationId: req.organisationId,
      subtotal: req.body.subtotal,
      taxTotal: req.body.taxTotal || 0,
      total: req.body.total,
      reason: req.body.reason,
      idempotencyKey: req.body.idempotencyKey,
      creditedAt: req.body.creditedAt,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json({ message: "Facture fournisseur introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/bills/:id/void", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await supplierBillLifecycleService.voidSupplierBill({
      billId: req.params.id,
      organisationId: req.organisationId,
      reason: req.body.reason,
      idempotencyKey: req.body.idempotencyKey,
      voidedAt: req.body.voidedAt,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json({ message: "Facture fournisseur introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.get("/bills/:id/payments", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM supplier_payments
       WHERE organisation_id = $1 AND supplier_bill_id = $2
       ORDER BY paid_at DESC, id DESC`,
      [req.organisationId, req.params.id],
    );
    return res.json({ payments: rows });
  } catch (error) {
    return next(error);
  }
});

router.post("/bills/:id/payments", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await supplierPaymentService.recordSupplierPayment({
      organisationId: req.organisationId,
      billId: req.params.id,
      amount: req.body.amount,
      paidAt: req.body.paidAt,
      paymentMethod: req.body.paymentMethod,
      reference: req.body.reference,
      idempotencyKey: req.body.idempotencyKey,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json({ message: "Facture fournisseur introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/payments/:paymentId/reverse", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await paymentReversalService.reverseSupplierPayment({
      organisationId: req.organisationId,
      paymentId: req.params.paymentId,
      reason: req.body.reason,
      reversedAt: req.body.reversedAt,
      idempotencyKey: req.body.idempotencyKey,
      createdBy: req.user?.id,
    });
    if (!result) return res.status(404).json({ message: "Paiement fournisseur introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
