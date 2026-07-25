const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");
const accountingPostingService = require("../../services/business/accounting-posting.service");

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
      `SELECT b.*, s.name supplier_name
       FROM supplier_bills b
       JOIN suppliers s ON s.id = b.supplier_id
       WHERE b.organisation_id = $1
       ORDER BY bill_date DESC`,
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
      [
        req.organisationId,
        body.supplierId,
        body.billNumber,
        body.billDate,
        body.dueDate || null,
        subtotal,
        taxTotal,
        total,
      ],
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

module.exports = router;
