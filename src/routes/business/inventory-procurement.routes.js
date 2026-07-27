const router = require("express").Router();
const requireRole = require("../../middleware/requireRole");
const service = require("../../services/business/inventory-procurement.service");

router.get("/purchase-orders", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT po.*,s.name supplier_name,
              COALESCE(json_agg(json_build_object(
                'id',l.id,'inventoryItemId',l.inventory_item_id,'description',l.description,
                'orderedQuantity',l.ordered_quantity,'receivedQuantity',l.received_quantity,
                'returnedQuantity',l.returned_quantity,'unitCost',l.unit_cost,'taxRate',l.tax_rate
              ) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL),'[]') lines
       FROM procurement_purchase_orders po
       JOIN suppliers s ON s.organisation_id=po.organisation_id AND s.id=po.supplier_id
       LEFT JOIN procurement_purchase_order_lines l ON l.organisation_id=po.organisation_id AND l.purchase_order_id=po.id
       WHERE po.organisation_id=$1
       GROUP BY po.id,s.name ORDER BY po.created_at DESC`,
      [req.organisationId],
    );
    return res.json({ purchaseOrders: rows });
  } catch (error) { return next(error); }
});

router.post("/purchase-orders", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await service.createPurchaseOrder({
      organisationId: req.organisationId,
      actorUserId: req.user?.id,
      supplierId: req.body.supplierId,
      purchaseOrderNumber: req.body.purchaseOrderNumber,
      expectedAt: req.body.expectedAt,
      currency: req.body.currency || "CAD",
      lines: req.body.lines,
      idempotencyKey: req.body.idempotencyKey,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.post("/purchase-orders/:id/approve", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await service.approvePurchaseOrder({
      organisationId: req.organisationId,
      purchaseOrderId: req.params.id,
      actorUserId: req.user?.id,
    });
    if (!result) return res.status(404).json({ message: "Commande d’achat introuvable." });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.post("/purchase-orders/:id/receipts", requireRole("admin"), async (req, res, next) => {
  try {
    const result = await service.receivePurchaseOrder({
      organisationId: req.organisationId,
      purchaseOrderId: req.params.id,
      actorUserId: req.user?.id,
      receiptNumber: req.body.receiptNumber,
      receivedAt: req.body.receivedAt,
      lines: req.body.lines,
      idempotencyKey: req.body.idempotencyKey,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.get("/purchase-orders/:id/receipts", async (req, res, next) => {
  try {
    const { rows } = await req.db.query(
      `SELECT r.*,
              COALESCE(json_agg(json_build_object(
                'id',rl.id,'purchaseOrderLineId',rl.purchase_order_line_id,'locationId',rl.location_id,
                'quantity',rl.quantity,'acceptedQuantity',rl.accepted_quantity,
                'rejectedQuantity',rl.rejected_quantity,'unitCost',rl.unit_cost,
                'conditionStatus',rl.condition_status,'note',rl.note
              ) ORDER BY rl.id) FILTER (WHERE rl.id IS NOT NULL),'[]') lines
       FROM procurement_receipts r
       LEFT JOIN procurement_receipt_lines rl ON rl.organisation_id=r.organisation_id AND rl.receipt_id=r.id
       WHERE r.organisation_id=$1 AND r.purchase_order_id=$2
       GROUP BY r.id ORDER BY r.received_at DESC`,
      [req.organisationId, req.params.id],
    );
    return res.json({ receipts: rows });
  } catch (error) { return next(error); }
});

module.exports = router;
