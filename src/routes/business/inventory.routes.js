const router = require("express").Router();
const { requireOrganisation } = require("../../middleware/organization.middleware");
const requireRole = require("../../middleware/requireRole");

router.use(requireOrganisation);

router.get("/items", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT i.*, COALESCE(SUM(m.quantity), 0)::numeric quantity_on_hand
       FROM inventory_items i
       LEFT JOIN inventory_movements m ON m.item_id = i.id
       WHERE i.organisation_id = $1
       GROUP BY i.id
       ORDER BY i.name`,
      [req.organisationId],
    );
    res.json({ items: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/items", requireRole("admin"), async (req, res, next) => {
  try {
    const body = req.body;
    const { rows } = await req.db.query(
      `INSERT INTO inventory_items
       (organisation_id, sku, name, description, unit, cost, sale_price, reorder_point)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        req.organisationId,
        body.sku,
        body.name,
        body.description || null,
        body.unit || "unité",
        body.cost || 0,
        body.salePrice || 0,
        body.reorderPoint || 0,
      ],
    );
    res.status(201).json({ item: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/locations", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      "SELECT * FROM inventory_locations WHERE organisation_id = $1 ORDER BY name",
      [req.organisationId],
    );
    res.json({ locations: rows });
  } catch (error) {
    next(error);
  }
});

router.post("/movements", requireRole("admin"), async (req, res, next) => {
  try {
    const body = req.body;
    const { rows } = await req.db.query(
      `INSERT INTO inventory_movements
       (organisation_id, item_id, location_id, movement_type, quantity, unit_cost,
        reference_type, reference_id, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.organisationId,
        body.itemId,
        body.locationId,
        body.movementType,
        body.quantity,
        body.unitCost || 0,
        body.referenceType || null,
        body.referenceId || null,
        body.note || null,
        req.user?.id || null,
      ],
    );
    res.status(201).json({ movement: rows[0] });
  } catch (error) {
    next(error);
  }
});

router.get("/alerts", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT i.id, i.sku, i.name, i.reorder_point,
              COALESCE(SUM(m.quantity), 0)::numeric quantity_on_hand
       FROM inventory_items i
       LEFT JOIN inventory_movements m ON m.item_id = i.id
       WHERE i.organisation_id = $1
       GROUP BY i.id
       HAVING COALESCE(SUM(m.quantity), 0) <= i.reorder_point
       ORDER BY i.name`,
      [req.organisationId],
    );
    res.json({ alerts: rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
