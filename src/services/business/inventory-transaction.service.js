const crypto = require("crypto");
const { organisationValue } = require("../../utils/organisationScope");
const { executeTransaction, registerPolicy } = require("./transaction-engine.service");
const { appendEvent } = require("./business-event.service");
const { persistTrustAssessment, persistGraphEdges } = require("./trust-persistence.service");
const { loadAccounts, recordPostedEntry } = require("./accounting-sync.service");

const POLICIES = {
  receive: "inventory.stock.receive@1",
  issue: "inventory.stock.issue@1",
  transfer: "inventory.stock.transfer@1",
  adjust: "inventory.stock.adjust@1",
  reverse: "inventory.stock.reverse@1",
};

function number(value, allowZero = false) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return null;
  return Number(n.toFixed(4));
}
function validKey(value) { return Boolean(value && String(value).trim().length >= 8); }
function reasonRequired(input) { return Boolean(String(input?.reason || "").trim()); }

for (const [name, ref] of Object.entries(POLICIES)) {
  const [policyName, version] = ref.split("@");
  registerPolicy(policyName, version, ({ input, idempotencyKey }) => {
    if (!validKey(idempotencyKey)) return { allowed: false, statusCode: 400, code: `${name}.idempotency_invalid`, reason: "Une clé d’idempotence valide est obligatoire." };
    if (!input?.itemId) return { allowed: false, statusCode: 400, code: `${name}.item_required`, reason: "Un article est requis." };
    if (!number(input.quantity)) return { allowed: false, statusCode: 400, code: `${name}.quantity_invalid`, reason: "La quantité doit être supérieure à zéro." };
    if (["adjust", "reverse"].includes(name) && !reasonRequired(input)) return { allowed: false, statusCode: 400, code: `${name}.reason_required`, reason: "Une raison est obligatoire." };
    return { allowed: true, code: `${name}.valid` };
  });
}

async function lockItem(client, organisationId, itemId) {
  const { rows } = await client.query("SELECT * FROM inventory_items WHERE organisation_id=$1 AND id=$2 AND is_active=true FOR UPDATE", [organisationId, itemId]);
  return rows[0] || null;
}
async function lockBalance(client, organisationId, itemId, locationId) {
  await client.query(`INSERT INTO inventory_balances (organisation_id,item_id,location_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [organisationId, itemId, locationId]);
  const { rows } = await client.query(`SELECT * FROM inventory_balances WHERE organisation_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`, [organisationId, itemId, locationId]);
  return rows[0];
}
async function existingOperation(client, organisationId, idempotencyKey) {
  const { rows } = await client.query(`SELECT * FROM inventory_operation_log WHERE organisation_id=$1 AND idempotency_key=$2`, [organisationId, String(idempotencyKey).trim()]);
  return rows[0] || null;
}
async function insertMovement(client, payload) {
  const { rows } = await client.query(
    `INSERT INTO inventory_movements (organisation_id,item_id,location_id,movement_type,quantity,unit_cost,reference_type,reference_id,note,created_by,movement_group_id,idempotency_key,occurred_at,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13::timestamptz,NOW()),$14) RETURNING *`,
    [payload.organisationId,payload.itemId,payload.locationId,payload.movementType,payload.quantity,payload.unitCost,payload.referenceType||null,payload.referenceId||null,payload.note||null,payload.createdBy||null,payload.groupId,payload.idempotencyKey,payload.occurredAt||null,payload.metadata||{}],
  );
  return rows[0];
}
async function updateBalance(client, balance, quantityDelta, unitCost, movementId) {
  const oldQty = Number(balance.quantity);
  const oldCost = Number(balance.weighted_average_cost);
  const newQty = Number((oldQty + quantityDelta).toFixed(4));
  if (newQty < 0) throw Object.assign(new Error("Stock insuffisant à cet emplacement."), { statusCode: 409, details: { available: oldQty } });
  let newCost = oldCost;
  if (quantityDelta > 0) newCost = newQty === 0 ? 0 : Number((((oldQty * oldCost) + (quantityDelta * unitCost)) / newQty).toFixed(4));
  if (newQty === 0) newCost = 0;
  const value = Number((newQty * newCost).toFixed(2));
  const { rows } = await client.query(`UPDATE inventory_balances SET quantity=$1,weighted_average_cost=$2,inventory_value=$3,last_movement_id=$4,updated_at=NOW() WHERE id=$5 RETURNING *`, [newQty,newCost,value,movementId,balance.id]);
  await client.query(`UPDATE inventory_items SET weighted_average_cost=$1,updated_at=NOW() WHERE organisation_id=$2 AND id=$3`, [newCost,balance.organisation_id,balance.item_id]);
  return rows[0];
}
async function accountOperation(client, { organisationId, userId, operation, operationId, quantity, unitCost, occurredAt }) {
  if (operation === "transfer") return { skipped: true, reason: "non_financial_transfer" };
  const amount = Number((quantity * unitCost).toFixed(2));
  const codesByOperation = {
    receive: ["1200", "2000"], issue: ["5000", "1200"], adjust_in: ["1200", "4950"], adjust_out: ["6950", "1200"],
  };
  const codes = codesByOperation[operation];
  const accounts = await loadAccounts(client, organisationId, codes);
  if (!codes.every((code) => accounts.has(code))) return { skipped: true, reason: "chart_of_accounts_not_initialized" };
  const lines = operation === "receive" ? [
    { accountId: accounts.get("1200"), debit: amount, credit: 0, description: "Augmentation de l’inventaire" },
    { accountId: accounts.get("2000"), debit: 0, credit: amount, description: "Contrepartie fournisseur" },
  ] : operation === "issue" ? [
    { accountId: accounts.get("5000"), debit: amount, credit: 0, description: "Coût des marchandises sorties" },
    { accountId: accounts.get("1200"), debit: 0, credit: amount, description: "Réduction de l’inventaire" },
  ] : operation === "adjust_in" ? [
    { accountId: accounts.get("1200"), debit: amount, credit: 0 }, { accountId: accounts.get("4950"), debit: 0, credit: amount },
  ] : [
    { accountId: accounts.get("6950"), debit: amount, credit: 0 }, { accountId: accounts.get("1200"), debit: 0, credit: amount },
  ];
  return recordPostedEntry(client, { organisationId,userId,journalCode:"INV",journalName:"Journal d’inventaire",journalType:"inventory",entryNumber:`INV-${operationId}`,entryDate:(occurredAt||new Date().toISOString()).slice(0,10),description:`Mouvement d’inventaire ${operationId}`,sourceType:"inventory_operation",sourceId:operationId,lines });
}

async function executeInventoryOperation(input) {
  const policy = POLICIES[input.operation];
  return executeTransaction({
    type: `inventory.stock.${input.operation}`,
    organisationId: organisationValue(input.organisationId),
    actorUserId: input.createdBy,
    idempotencyKey: input.idempotencyKey,
    policies: [policy],
    input,
    execute: async ({ client, transactionId, correlationId, organisationId, actorUserId, idempotencyKey }) => {
      const duplicate = await existingOperation(client, organisationId, idempotencyKey);
      if (duplicate) return { duplicate: true, operation: duplicate };
      const item = await lockItem(client, organisationId, input.itemId);
      if (!item) return null;
      const groupId = crypto.randomUUID();
      const quantity = number(input.quantity);
      const sourceId = input.sourceLocationId || input.locationId || null;
      const destinationId = input.destinationLocationId || input.locationId || null;
      if (input.operation === "transfer" && (!sourceId || !destinationId || Number(sourceId) === Number(destinationId))) throw Object.assign(new Error("Le transfert exige deux emplacements différents."), { statusCode: 400 });
      if (["receive"].includes(input.operation) && !destinationId) throw Object.assign(new Error("Un emplacement de destination est requis."), { statusCode: 400 });
      if (["issue"].includes(input.operation) && !sourceId) throw Object.assign(new Error("Un emplacement source est requis."), { statusCode: 400 });
      const movements = [];
      let accounting = { skipped: true, reason: "not_applicable" };
      let effectiveCost = number(input.unitCost, true) ?? Number(item.weighted_average_cost || item.cost || 0);
      if (input.operation === "receive") {
        const balance = await lockBalance(client, organisationId, item.id, destinationId);
        if (effectiveCost <= 0) throw Object.assign(new Error("Le coût unitaire de réception doit être supérieur à zéro."), { statusCode: 400 });
        const movement = await insertMovement(client,{organisationId,itemId:item.id,locationId:destinationId,movementType:"receipt",quantity,unitCost:effectiveCost,groupId,idempotencyKey,occurredAt:input.occurredAt,createdBy:actorUserId,referenceType:input.referenceType,referenceId:input.referenceId,note:input.reason,metadata:{transactionId,correlationId}});
        movements.push(movement); await updateBalance(client,balance,quantity,effectiveCost,movement.id); accounting=await accountOperation(client,{organisationId,userId:actorUserId,operation:"receive",operationId:groupId,quantity,unitCost:effectiveCost,occurredAt:input.occurredAt});
      } else if (input.operation === "issue") {
        const balance = await lockBalance(client, organisationId, item.id, sourceId); effectiveCost=Number(balance.weighted_average_cost);
        const movement = await insertMovement(client,{organisationId,itemId:item.id,locationId:sourceId,movementType:"issue",quantity:-quantity,unitCost:effectiveCost,groupId,idempotencyKey,occurredAt:input.occurredAt,createdBy:actorUserId,referenceType:input.referenceType,referenceId:input.referenceId,note:input.reason,metadata:{transactionId,correlationId}});
        movements.push(movement); await updateBalance(client,balance,-quantity,effectiveCost,movement.id); accounting=await accountOperation(client,{organisationId,userId:actorUserId,operation:"issue",operationId:groupId,quantity,unitCost:effectiveCost,occurredAt:input.occurredAt});
      } else if (input.operation === "transfer") {
        const ids=[Number(sourceId),Number(destinationId)].sort((a,b)=>a-b); const first=await lockBalance(client,organisationId,item.id,ids[0]); const second=await lockBalance(client,organisationId,item.id,ids[1]); const source=Number(first.location_id)===Number(sourceId)?first:second; const destination=source===first?second:first; effectiveCost=Number(source.weighted_average_cost);
        const out=await insertMovement(client,{organisationId,itemId:item.id,locationId:sourceId,movementType:"transfer_out",quantity:-quantity,unitCost:effectiveCost,groupId,idempotencyKey:`${idempotencyKey}:out`,occurredAt:input.occurredAt,createdBy:actorUserId,note:input.reason,metadata:{transactionId,correlationId,destinationLocationId:destinationId}});
        const incoming=await insertMovement(client,{organisationId,itemId:item.id,locationId:destinationId,movementType:"transfer_in",quantity,unitCost:effectiveCost,groupId,idempotencyKey:`${idempotencyKey}:in`,occurredAt:input.occurredAt,createdBy:actorUserId,note:input.reason,metadata:{transactionId,correlationId,sourceLocationId:sourceId}});
        movements.push(out,incoming); await updateBalance(client,source,-quantity,effectiveCost,out.id); await updateBalance(client,destination,quantity,effectiveCost,incoming.id);
      } else if (input.operation === "adjust") {
        const locationId=input.locationId; if(!locationId) throw Object.assign(new Error("Un emplacement est requis."),{statusCode:400}); const balance=await lockBalance(client,organisationId,item.id,locationId); const delta=Number(input.direction)==-1?-quantity:quantity; effectiveCost=Number(balance.weighted_average_cost||input.unitCost||item.cost||0); if(effectiveCost<=0) throw Object.assign(new Error("Un coût unitaire est requis pour l’ajustement."),{statusCode:400});
        const movement=await insertMovement(client,{organisationId,itemId:item.id,locationId,movementType:delta>0?"adjustment_in":"adjustment_out",quantity:delta,unitCost:effectiveCost,groupId,idempotencyKey,occurredAt:input.occurredAt,createdBy:actorUserId,note:input.reason,metadata:{transactionId,correlationId}}); movements.push(movement); await updateBalance(client,balance,delta,effectiveCost,movement.id); accounting=await accountOperation(client,{organisationId,userId:actorUserId,operation:delta>0?"adjust_in":"adjust_out",operationId:groupId,quantity,unitCost:effectiveCost,occurredAt:input.occurredAt});
      } else throw Object.assign(new Error("Opération d’inventaire non prise en charge."), { statusCode: 400 });
      if(accounting.entryId) await client.query(`UPDATE inventory_movements SET accounting_entry_id=$1 WHERE organisation_id=$2 AND movement_group_id=$3`,[accounting.entryId,organisationId,groupId]);
      const log=(await client.query(`INSERT INTO inventory_operation_log (organisation_id,transaction_id,correlation_id,operation_type,movement_group_id,idempotency_key,item_id,source_location_id,destination_location_id,quantity,unit_cost,accounting_entry_id,actor_user_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,[organisationId,transactionId,correlationId,input.operation,groupId,String(idempotencyKey).trim(),item.id,sourceId,destinationId,quantity,effectiveCost,accounting.entryId||null,actorUserId||null,input.reason||null])).rows[0];
      const event=await appendEvent(client,{organisationId,eventType:`inventory.stock.${input.operation}d`,aggregateType:"inventory_item",aggregateId:item.id,actorUserId,correlationId,occurredAt:input.occurredAt,metadata:{transactionId,policyVersions:[policy],idempotencyKey},payload:{itemId:item.id,movementGroupId:groupId,quantity,unitCost:effectiveCost,sourceLocationId:sourceId,destinationLocationId:destinationId,accountingEntryId:accounting.entryId||null}});
      const trust=await persistTrustAssessment(client,{organisationId,transactionId,correlationId,checks:[{code:"inventory.movement.persisted",passed:movements.length>0,evidence:[{movementIds:movements.map(m=>m.id)}]},{code:"inventory.no_negative_stock",passed:true,evidence:[{itemId:item.id}]},{code:"inventory.event_recorded",passed:Boolean(event?.event_id),evidence:[{eventId:event?.event_id||null}]}]});
      const graph=await persistGraphEdges(client,{organisationId,transactionId,correlationId,edges:[{from:{type:"inventory_item",id:item.id},relation:"affected_by",to:{type:"inventory_operation",id:log.id},provenance:{eventId:event.event_id}},{from:{type:"inventory_operation",id:log.id},relation:"produces",to:{type:"business_event",id:event.event_id},provenance:{eventId:event.event_id}},...(accounting.entryId?[{from:{type:"inventory_operation",id:log.id},relation:"accounted_as",to:{type:"accounting_entry",id:accounting.entryId},provenance:{eventId:event.event_id}}]:[]),{from:{type:"madtrust_assessment",id:trust.assessmentId},relation:"assesses",to:{type:"inventory_operation",id:log.id},provenance:{transactionId}}]});
      return { duplicate:false,operation:log,movements,accounting,event,trust,graph };
    },
    verify: async ({ result }) => { if(result&&!result.duplicate&&(!result.movements?.length||!result.event?.event_id||!result.trust?.assessmentId)) throw new Error("Validation postérieure de l’opération d’inventaire incomplète."); },
  }).then((transaction)=>transaction.result?{...transaction.result,ct_mad:{transactionId:transaction.transactionId,correlationId:transaction.correlationId,status:transaction.status,policies:transaction.policyResults}}:null);
}

module.exports={POLICIES,number,validKey,executeInventoryOperation};
