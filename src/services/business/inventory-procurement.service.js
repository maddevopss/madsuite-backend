const pool = require("../../../db");
const inventoryTransactionService = require("./inventory-transaction.service");

function positive(value, decimals = 3) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(decimals)) : null;
}

function validKey(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

async function createPurchaseOrder({ organisationId, actorUserId, supplierId, purchaseOrderNumber, expectedAt, currency = "CAD", lines, idempotencyKey }) {
  if (!supplierId || !String(purchaseOrderNumber || "").trim()) throw Object.assign(new Error("Le fournisseur et le numéro de commande sont obligatoires."), { statusCode: 400 });
  if (!validKey(idempotencyKey)) throw Object.assign(new Error("Une clé d’idempotence valide est obligatoire."), { statusCode: 400 });
  if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error("La commande doit contenir au moins une ligne."), { statusCode: 400 });

  const normalized = lines.map((line) => ({
    inventoryItemId: Number(line.inventoryItemId),
    description: String(line.description || "").trim(),
    quantity: positive(line.quantity),
    unitCost: positive(line.unitCost, 4),
    taxRate: Number.isFinite(Number(line.taxRate)) && Number(line.taxRate) >= 0 ? Number(line.taxRate) : 0,
  }));
  if (normalized.some((line) => !line.inventoryItemId || !line.description || !line.quantity || line.unitCost === null)) {
    throw Object.assign(new Error("Une ligne de commande est invalide."), { statusCode: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id',$1,true)", [String(organisationId)]);
    const duplicate = await client.query("SELECT * FROM procurement_purchase_orders WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE", [organisationId, String(idempotencyKey).trim()]);
    if (duplicate.rows[0]) {
      await client.query("COMMIT");
      return { duplicate: true, purchaseOrder: duplicate.rows[0] };
    }
    const supplier = await client.query("SELECT id FROM suppliers WHERE organisation_id=$1 AND id=$2", [organisationId, supplierId]);
    if (!supplier.rows[0]) throw Object.assign(new Error("Fournisseur introuvable."), { statusCode: 404 });

    const itemIds = normalized.map((line) => line.inventoryItemId);
    const items = await client.query("SELECT id FROM inventory_items WHERE organisation_id=$1 AND id=ANY($2::bigint[]) AND is_active=TRUE", [organisationId, itemIds]);
    if (items.rowCount !== new Set(itemIds).size) throw Object.assign(new Error("Un article est introuvable ou inactif."), { statusCode: 404 });

    const subtotal = normalized.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
    const taxes = normalized.reduce((sum, line) => sum + line.quantity * line.unitCost * line.taxRate, 0);
    const inserted = await client.query(
      `INSERT INTO procurement_purchase_orders
       (organisation_id,purchase_order_number,supplier_id,currency,subtotal,taxes,total,expected_at,status,idempotency_key,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10) RETURNING *`,
      [organisationId, String(purchaseOrderNumber).trim(), supplierId, currency, subtotal.toFixed(2), taxes.toFixed(2), (subtotal + taxes).toFixed(2), expectedAt || null, String(idempotencyKey).trim(), actorUserId || null],
    );
    const purchaseOrder = inserted.rows[0];
    const createdLines = [];
    for (const line of normalized) {
      const result = await client.query(
        `INSERT INTO procurement_purchase_order_lines
         (organisation_id,purchase_order_id,inventory_item_id,description,ordered_quantity,unit_cost,tax_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [organisationId, purchaseOrder.id, line.inventoryItemId, line.description, line.quantity, line.unitCost, line.taxRate],
      );
      createdLines.push(result.rows[0]);
    }
    await client.query("COMMIT");
    return { duplicate: false, purchaseOrder, lines: createdLines };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function approvePurchaseOrder({ organisationId, purchaseOrderId, actorUserId }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id',$1,true)", [String(organisationId)]);
    const order = await client.query("SELECT * FROM procurement_purchase_orders WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [organisationId, purchaseOrderId]);
    if (!order.rows[0]) return null;
    if (order.rows[0].status === "approved") { await client.query("COMMIT"); return { duplicate: true, purchaseOrder: order.rows[0] }; }
    if (order.rows[0].status !== "draft") throw Object.assign(new Error("Seule une commande brouillon peut être approuvée."), { statusCode: 409 });
    const updated = await client.query("UPDATE procurement_purchase_orders SET status='approved', updated_at=NOW(), evidence=evidence || $1::jsonb WHERE organisation_id=$2 AND id=$3 RETURNING *", [JSON.stringify([{ type: "approval", actorUserId, at: new Date().toISOString() }]), organisationId, purchaseOrderId]);
    await client.query("COMMIT");
    return { duplicate: false, purchaseOrder: updated.rows[0] };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function receivePurchaseOrder({ organisationId, purchaseOrderId, actorUserId, receiptNumber, receivedAt, lines, idempotencyKey }) {
  if (!validKey(idempotencyKey) || !String(receiptNumber || "").trim()) throw Object.assign(new Error("Le numéro de réception et une clé d’idempotence valide sont obligatoires."), { statusCode: 400 });
  if (!Array.isArray(lines) || !lines.length) throw Object.assign(new Error("La réception doit contenir au moins une ligne."), { statusCode: 400 });

  const client = await pool.connect();
  let receipt;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id',$1,true)", [String(organisationId)]);
    const existing = await client.query("SELECT * FROM procurement_receipts WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE", [organisationId, String(idempotencyKey).trim()]);
    if (existing.rows[0]) { await client.query("COMMIT"); return { duplicate: true, receipt: existing.rows[0] }; }
    const order = await client.query("SELECT * FROM procurement_purchase_orders WHERE organisation_id=$1 AND id=$2 FOR UPDATE", [organisationId, purchaseOrderId]);
    if (!order.rows[0]) throw Object.assign(new Error("Commande d’achat introuvable."), { statusCode: 404 });
    if (!["approved","sent","partially_received"].includes(order.rows[0].status)) throw Object.assign(new Error("Cette commande ne peut pas être réceptionnée."), { statusCode: 409 });

    const inserted = await client.query(
      `INSERT INTO procurement_receipts
       (organisation_id,purchase_order_id,receipt_number,received_at,received_by,status,idempotency_key)
       VALUES ($1,$2,$3,COALESCE($4::timestamptz,NOW()),$5,'received',$6) RETURNING *`,
      [organisationId, purchaseOrderId, String(receiptNumber).trim(), receivedAt || null, actorUserId || null, String(idempotencyKey).trim()],
    );
    receipt = inserted.rows[0];

    const prepared = [];
    for (const input of lines) {
      const quantity = positive(input.quantity);
      const rejected = Number(input.rejectedQuantity || 0);
      const accepted = Number((quantity - rejected).toFixed(3));
      if (!quantity || rejected < 0 || accepted < 0 || !input.purchaseOrderLineId || !input.locationId) throw Object.assign(new Error("Une ligne de réception est invalide."), { statusCode: 400 });
      const line = await client.query("SELECT * FROM procurement_purchase_order_lines WHERE organisation_id=$1 AND purchase_order_id=$2 AND id=$3 FOR UPDATE", [organisationId, purchaseOrderId, input.purchaseOrderLineId]);
      if (!line.rows[0]) throw Object.assign(new Error("Ligne de commande introuvable."), { statusCode: 404 });
      const remaining = Number(line.rows[0].ordered_quantity) - Number(line.rows[0].received_quantity);
      if (quantity > remaining) throw Object.assign(new Error("La réception dépasse la quantité restante."), { statusCode: 409, details: { remaining, requested: quantity } });
      prepared.push({ input, orderLine: line.rows[0], quantity, rejected, accepted });
    }

    for (const row of prepared) {
      await client.query(
        `INSERT INTO procurement_receipt_lines
         (organisation_id,receipt_id,purchase_order_line_id,location_id,quantity,accepted_quantity,rejected_quantity,unit_cost,condition_status,note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [organisationId, receipt.id, row.orderLine.id, row.input.locationId, row.quantity, row.accepted, row.rejected, row.input.unitCost ?? row.orderLine.unit_cost, row.rejected === 0 ? "accepted" : row.accepted === 0 ? "rejected" : "partial", row.input.note || null],
      );
      await client.query("UPDATE procurement_purchase_order_lines SET received_quantity=received_quantity+$1,updated_at=NOW() WHERE organisation_id=$2 AND id=$3", [row.quantity, organisationId, row.orderLine.id]);
    }
    await client.query("COMMIT");

    const inventoryResults = [];
    for (const row of prepared.filter((entry) => entry.accepted > 0)) {
      const movement = await inventoryTransactionService.postInventoryTransaction({
        organisationId,
        actorUserId,
        type: "receipt",
        itemId: row.orderLine.inventory_item_id,
        locationId: row.input.locationId,
        quantity: row.accepted,
        unitCost: row.input.unitCost ?? row.orderLine.unit_cost,
        reason: `Réception fournisseur ${receipt.receipt_number}`,
        referenceType: "procurement_receipt",
        referenceId: String(receipt.id),
        idempotencyKey: `${String(idempotencyKey).trim()}:line:${row.orderLine.id}`,
        occurredAt: receivedAt,
      });
      inventoryResults.push(movement);
    }

    const finalClient = await pool.connect();
    try {
      await finalClient.query("BEGIN");
      const remaining = await finalClient.query("SELECT COUNT(*)::integer pending FROM procurement_purchase_order_lines WHERE organisation_id=$1 AND purchase_order_id=$2 AND received_quantity < ordered_quantity", [organisationId, purchaseOrderId]);
      const status = remaining.rows[0].pending === 0 ? "received" : "partially_received";
      await finalClient.query("UPDATE procurement_purchase_orders SET status=$1,updated_at=NOW() WHERE organisation_id=$2 AND id=$3", [status, organisationId, purchaseOrderId]);
      await finalClient.query("UPDATE procurement_receipts SET status=$1 WHERE organisation_id=$2 AND id=$3", [status === "received" ? "received" : "partial", organisationId, receipt.id]);
      await finalClient.query("COMMIT");
    } catch (error) { await finalClient.query("ROLLBACK"); throw error; } finally { finalClient.release(); }

    return { duplicate: false, receipt, inventoryResults };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

module.exports = { createPurchaseOrder, approvePurchaseOrder, receivePurchaseOrder };
