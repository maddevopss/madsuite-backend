const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const { recordPostedEntry } = require("./accounting-sync.service");

const RECEIPT_POLICY = "inventory.receipt.post@1";
const ISSUE_POLICY = "inventory.issue.post@1";
const ADJUST_POLICY = "inventory.adjustment.post@1";
const TRANSFER_POLICY = "inventory.transfer.post@1";

function normalizeQuantity(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(3)) : null;
}

function normalizeCost(value, { allowZero = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return null;
  return Number(n.toFixed(4));
}

function validIdempotency(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

function basePolicy(type) {
  return ({ input, idempotencyKey }) => {
    if (!input?.itemId || !input?.locationId) return { allowed: false, statusCode: 400, code: `${type}.target_required`, reason: "L’article et l’emplacement sont obligatoires." };
    if (!normalizeQuantity(input.quantity)) return { allowed: false, statusCode: 400, code: `${type}.quantity_invalid`, reason: "La quantité doit être supérieure à zéro." };
    if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: `${type}.idempotency_invalid`, reason: "Une clé d’idempotence valide est obligatoire." };
    return { allowed: true, code: `${type}.valid` };
  };
}

registerPolicy("inventory.receipt.post", "1", (context) => {
  const result = basePolicy("inventory_receipt")(context);
  if (!result.allowed) return result;
  if (!normalizeCost(context.input.unitCost)) return { allowed: false, statusCode: 400, code: "inventory_receipt.cost_invalid", reason: "Le coût unitaire doit être supérieur à zéro." };
  return result;
});
registerPolicy("inventory.issue.post", "1", basePolicy("inventory_issue"));
registerPolicy("inventory.adjustment.post", "1", (context) => {
  const result = basePolicy("inventory_adjustment")(context);
  if (!result.allowed) return result;
  if (!String(context.input.reason || "").trim()) return { allowed: false, statusCode: 400, code: "inventory_adjustment.reason_required", reason: "La raison de l’ajustement est obligatoire." };
  if (!["increase", "decrease"].includes(context.input.direction)) return { allowed: false, statusCode: 400, code: "inventory_adjustment.direction_invalid", reason: "La direction doit être increase ou decrease." };
  return result;
});
registerPolicy("inventory.transfer.post", "1", ({ input, idempotencyKey }) => {
  const result = basePolicy("inventory_transfer")({ input, idempotencyKey });
  if (!result.allowed) return result;
  if (!input.destinationLocationId || Number(input.destinationLocationId) === Number(input.locationId)) return { allowed: false, statusCode: 400, code: "inventory_transfer.destination_invalid", reason: "Un emplacement de destination différent est obligatoire." };
  return result;
});

async function ensureDefaultAccounts(client, organisationId) {
  const defaults = [
    ["1200", "Inventaire", "asset", "debit"],
    ["2050", "Réception d’inventaire à rapprocher", "liability", "credit"],
    ["5000", "Coût des marchandises vendues", "expense", "debit"],
    ["6990", "Écarts d’inventaire", "expense", "debit"],
  ];
  for (const row of defaults) {
    await client.query(
      `INSERT INTO accounting_accounts (organisation_id,code,name,account_type,normal_balance)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organisation_id,code) DO NOTHING`,
      [organisationId, ...row],
    );
  }
  const { rows } = await client.query(
    `SELECT id,code FROM accounting_accounts WHERE organisation_id=$1 AND code=ANY($2::varchar[])`,
    [organisationId, defaults.map((row) => row[0])],
  );
  return new Map(rows.map((row) => [row.code, row.id]));
}

async function loadItemAndLocations(client, organisationId, input) {
  const item = await client.query(
    `SELECT * FROM inventory_items WHERE organisation_id=$1 AND id=$2 AND is_active=TRUE FOR UPDATE`,
    [organisationId, input.itemId],
  );
  if (!item.rows[0]) return null;
  const locationIds = [input.locationId, input.destinationLocationId].filter(Boolean);
  const locations = await client.query(
    `SELECT * FROM inventory_locations WHERE organisation_id=$1 AND id=ANY($2::bigint[]) AND is_active=TRUE ORDER BY id FOR UPDATE`,
    [organisationId, locationIds],
  );
  if (locations.rowCount !== new Set(locationIds.map(Number)).size) throw Object.assign(new Error("Un emplacement d’inventaire est introuvable ou inactif."), { statusCode: 404 });
  return { item: item.rows[0], locations: locations.rows };
}

async function lockBalance(client, organisationId, itemId, locationId) {
  await client.query(
    `INSERT INTO inventory_balances (organisation_id,item_id,location_id) VALUES ($1,$2,$3)
     ON CONFLICT (organisation_id,item_id,location_id) DO NOTHING`,
    [organisationId, itemId, locationId],
  );
  const { rows } = await client.query(
    `SELECT * FROM inventory_balances WHERE organisation_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`,
    [organisationId, itemId, locationId],
  );
  return rows[0];
}

function weightedAverage(currentQuantity, currentCost, receivedQuantity, receivedCost) {
  const totalQuantity = Number(currentQuantity) + Number(receivedQuantity);
  if (totalQuantity <= 0) return 0;
  return Number((((Number(currentQuantity) * Number(currentCost)) + (Number(receivedQuantity) * Number(receivedCost))) / totalQuantity).toFixed(4));
}

async function postAccounting(client, { organisationId, actorUserId, type, transactionRow, item, cost }) {
  if (type === "transfer") return { skipped: true, reason: "transfer_has_no_financial_effect" };
  const accounts = await ensureDefaultAccounts(client, organisationId);
  const inventoryAccount = item.asset_account_id || accounts.get("1200");
  const cogsAccount = item.expense_account_id || accounts.get("5000");
  const clearingAccount = accounts.get("2050");
  const adjustmentAccount = accounts.get("6990");
  let lines;
  if (type === "receipt" || (type === "adjustment" && transactionRow.metadata.direction === "increase")) {
    lines = [
      { accountId: inventoryAccount, description: "Augmentation de l’inventaire", debit: cost, credit: 0 },
      { accountId: type === "receipt" ? clearingAccount : adjustmentAccount, description: type === "receipt" ? "Réception à rapprocher" : "Gain d’inventaire", debit: 0, credit: cost },
    ];
  } else {
    lines = [
      { accountId: type === "issue" ? cogsAccount : adjustmentAccount, description: type === "issue" ? "Coût de sortie" : "Perte d’inventaire", debit: cost, credit: 0 },
      { accountId: inventoryAccount, description: "Réduction de l’inventaire", debit: 0, credit: cost },
    ];
  }
  return recordPostedEntry(client, {
    organisationId,
    userId: actorUserId,
    journalCode: "INV",
    journalName: "Journal d’inventaire",
    journalType: "inventory",
    entryNumber: `INV-${transactionRow.id}`,
    entryDate: new Date(transactionRow.occurred_at).toISOString().slice(0, 10),
    description: `${type} — ${item.sku}`,
    sourceType: "inventory_transaction",
    sourceId: transactionRow.id,
    lines,
  });
}

async function postInventoryTransaction({ organisationId, actorUserId, type, itemId, locationId, destinationLocationId, quantity, unitCost, direction, reason, referenceType, referenceId, idempotencyKey, occurredAt }) {
  const policy = { receipt: RECEIPT_POLICY, issue: ISSUE_POLICY, adjustment: ADJUST_POLICY, transfer: TRANSFER_POLICY }[type];
  if (!policy) throw Object.assign(new Error("Type de transaction d’inventaire invalide."), { statusCode: 400 });
  const transaction = await executeTransaction({
    type: `inventory.${type}.post`,
    organisationId: organisationValue(organisationId),
    actorUserId,
    idempotencyKey,
    policies: [policy],
    input: { itemId, locationId, destinationLocationId, quantity, unitCost, direction, reason, referenceType, referenceId, occurredAt },
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId: userId, idempotencyKey: key, input }) => {
      const existing = await client.query(`SELECT * FROM inventory_transactions WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE`, [orgId, String(key).trim()]);
      if (existing.rows[0]) return { duplicate: true, inventoryTransaction: existing.rows[0] };
      const target = await loadItemAndLocations(client, orgId, input);
      if (!target) return null;
      const qty = normalizeQuantity(input.quantity);
      const source = await lockBalance(client, orgId, input.itemId, input.locationId);
      const currentQty = Number(source.quantity);
      const currentCost = Number(source.average_cost);
      let movementCost = type === "receipt" ? normalizeCost(input.unitCost) : currentCost;
      let sourceDelta = 0;
      let destination = null;
      let destinationDelta = 0;
      if (type === "receipt") sourceDelta = qty;
      if (type === "issue") sourceDelta = -qty;
      if (type === "adjustment") sourceDelta = input.direction === "increase" ? qty : -qty;
      if (type === "transfer") {
        sourceDelta = -qty;
        destinationDelta = qty;
        destination = await lockBalance(client, orgId, input.itemId, input.destinationLocationId);
      }
      if (currentQty + sourceDelta < 0) throw Object.assign(new Error("Stock insuffisant pour cette opération."), { statusCode: 409, details: { available: currentQty, requested: qty } });
      if (type === "adjustment" && input.direction === "increase") movementCost = normalizeCost(input.unitCost, { allowZero: true }) ?? currentCost;
      const nextCost = sourceDelta > 0 ? weightedAverage(currentQty, currentCost, qty, movementCost) : currentCost;
      await client.query(
        `UPDATE inventory_balances SET quantity=$1,average_cost=$2,updated_at=NOW()
         WHERE organisation_id=$3 AND item_id=$4 AND location_id=$5`,
        [Number((currentQty + sourceDelta).toFixed(3)), nextCost, orgId, input.itemId, input.locationId],
      );
      if (destination) {
        const destinationCost = weightedAverage(destination.quantity, destination.average_cost, qty, currentCost);
        await client.query(
          `UPDATE inventory_balances SET quantity=$1,average_cost=$2,updated_at=NOW()
           WHERE organisation_id=$3 AND item_id=$4 AND location_id=$5`,
          [Number((Number(destination.quantity) + destinationDelta).toFixed(3)), destinationCost, orgId, input.itemId, input.destinationLocationId],
        );
      }
      const totalCost = Number((qty * movementCost).toFixed(4));
      const inserted = await client.query(
        `INSERT INTO inventory_transactions
          (organisation_id,transaction_id,transaction_type,item_id,source_location_id,destination_location_id,quantity,unit_cost,total_cost,reason,reference_type,reference_id,idempotency_key,created_by,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::timestamptz,NOW())) RETURNING *`,
        [orgId, transactionId, type, input.itemId, input.locationId, input.destinationLocationId || null, qty, movementCost, totalCost, input.reason || null, input.referenceType || null, input.referenceId || null, String(key).trim(), userId || null, input.occurredAt || null],
      );
      const inventoryTransaction = inserted.rows[0];
      const movementRows = [];
      const addMovement = async (movementType, loc, signedQty, transferLoc) => {
        const movement = await client.query(
          `INSERT INTO inventory_movements
            (organisation_id,item_id,location_id,movement_type,quantity,unit_cost,reference_type,reference_id,note,created_by,occurred_at,transaction_id,idempotency_key,transfer_location_id,metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
          [orgId,input.itemId,loc,movementType,signedQty,movementCost,input.referenceType || null,input.referenceId || null,input.reason || null,userId || null,inventoryTransaction.occurred_at,transactionId,`${String(key).trim()}:${movementType}:${loc}`,transferLoc || null,JSON.stringify({ direction: input.direction || null, inventoryTransactionId: inventoryTransaction.id })],
        );
        movementRows.push(movement.rows[0]);
      };
      if (type === "transfer") {
        await addMovement("transfer_out", input.locationId, -qty, input.destinationLocationId);
        await addMovement("transfer_in", input.destinationLocationId, qty, input.locationId);
      } else {
        const movementType = type === "adjustment" ? "adjustment" : type;
        await addMovement(movementType, input.locationId, sourceDelta, null);
      }
      const accounting = await postAccounting(client, { organisationId: orgId, actorUserId: userId, type, transactionRow: { ...inventoryTransaction, metadata: { direction: input.direction } }, item: target.item, cost: totalCost });
      if (accounting.entryId) {
        await client.query(`UPDATE inventory_transactions SET accounting_entry_id=$1 WHERE organisation_id=$2 AND id=$3`, [accounting.entryId, orgId, inventoryTransaction.id]);
        await client.query(`UPDATE inventory_movements SET accounting_entry_id=$1 WHERE organisation_id=$2 AND transaction_id=$3`, [accounting.entryId, orgId, transactionId]);
        inventoryTransaction.accounting_entry_id = accounting.entryId;
      }
      const eventType = `inventory.stock.${type === "receipt" ? "received" : type === "issue" ? "issued" : type === "transfer" ? "transferred" : "adjusted"}`;
      const event = await appendEvent(client, {
        organisationId: orgId, eventType, aggregateType: "inventory_item", aggregateId: input.itemId,
        actorUserId: userId, correlationId, occurredAt: inventoryTransaction.occurred_at,
        metadata: { transactionId, policyVersions: [policy], idempotencyKey: String(key).trim() },
        payload: { inventoryTransactionId: inventoryTransaction.id, itemId: input.itemId, sourceLocationId: input.locationId, destinationLocationId: input.destinationLocationId || null, quantity: qty, unitCost: movementCost, totalCost, accountingEntryId: accounting.entryId || null },
      });
      const trust = await persistTrustAssessment(client, {
        organisationId: orgId, transactionId, correlationId,
        checks: [
          { code: "inventory.transaction.persisted", passed: Boolean(inventoryTransaction.id), evidence: [{ inventoryTransactionId: inventoryTransaction.id }] },
          { code: "inventory.stock.non_negative", passed: currentQty + sourceDelta >= 0, evidence: [{ before: currentQty, after: currentQty + sourceDelta }] },
          { code: "inventory.event.recorded", passed: Boolean(event?.event_id), evidence: [{ eventId: event?.event_id || null }] },
          { code: "inventory.accounting.recorded", passed: type === "transfer" || Boolean(accounting.entryId), severity: type === "transfer" || accounting.entryId ? "info" : "warning", evidence: [{ accountingEntryId: accounting.entryId || null, reason: accounting.reason || null }] },
        ],
      });
      const graph = await persistGraphEdges(client, {
        organisationId: orgId, transactionId, correlationId,
        edges: [
          { from: { type: "inventory_item", id: input.itemId }, relation: type, to: { type: "inventory_transaction", id: inventoryTransaction.id }, provenance: { eventId: event.event_id } },
          { from: { type: "inventory_transaction", id: inventoryTransaction.id }, relation: "produces", to: { type: "business_event", id: event.event_id }, provenance: { eventId: event.event_id } },
          ...(accounting.entryId ? [{ from: { type: "inventory_transaction", id: inventoryTransaction.id }, relation: "accounted_as", to: { type: "accounting_entry", id: accounting.entryId }, provenance: { eventId: event.event_id } }] : []),
          { from: { type: "madtrust_assessment", id: trust.assessmentId }, relation: "assesses", to: { type: "inventory_transaction", id: inventoryTransaction.id }, provenance: { transactionId } },
        ],
      });
      return { duplicate: false, inventoryTransaction, movements: movementRows, accounting, event, trust, graph };
    },
    verify: async ({ result }) => {
      if (!result || result.duplicate) return;
      if (!result.inventoryTransaction?.id || !result.event?.event_id || !result.trust?.assessmentId) throw new Error("Validation postérieure de la transaction d’inventaire incomplète.");
    },
  });
  return transaction.result ? { ...transaction.result, ct_mad: { transactionId: transaction.transactionId, correlationId: transaction.correlationId, status: transaction.status, policies: transaction.policyResults } } : null;
}

module.exports = {
  RECEIPT_POLICY,
  ISSUE_POLICY,
  ADJUST_POLICY,
  TRANSFER_POLICY,
  normalizeQuantity,
  normalizeCost,
  validIdempotency,
  weightedAverage,
  postInventoryTransaction,
};
