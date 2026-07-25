const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");

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
    const total = Number(body.subtotal || 0) + Number(body.taxTotal || 0);
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
        body.subtotal || 0,
        body.taxTotal || 0,
        total,
      ],
    );
    res.status(201).json({ bill: rows[0] });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
