const pool = require('../../../db');

function httpError(message, statusCode = 400, details) {
  return Object.assign(new Error(message), { statusCode, details });
}

function positiveQuantity(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Number(n.toFixed(3)) : null;
}

function validKey(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function appendTrace(client, input) {
  const { rows } = await client.query(
    `INSERT INTO inventory_trace_events
      (organisation_id,item_id,lot_id,serial_id,location_id,event_type,quantity,reference_type,reference_id,reason,actor_user_id,occurred_at,metadata,idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12::timestamptz,NOW()),$13::jsonb,$14)
     ON CONFLICT (organisation_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
     RETURNING *`,
    [input.organisationId,input.itemId,input.lotId || null,input.serialId || null,input.locationId || null,input.eventType,input.quantity || null,input.referenceType || null,input.referenceId || null,input.reason || null,input.actorUserId || null,input.occurredAt || null,JSON.stringify(input.metadata || {}),String(input.idempotencyKey).trim()],
  );
  return rows[0];
}

async function receiveTrackedStock(input = {}) {
  const quantity = positiveQuantity(input.quantity);
  if (!input.organisationId || !input.itemId || !input.locationId || !quantity) throw httpError('Organisation, article, emplacement et quantité sont obligatoires.');
  if (!validKey(input.idempotencyKey)) throw httpError('Une clé d’idempotence valide est obligatoire.');

  return withTransaction(async (client) => {
    const existing = await client.query(
      `SELECT * FROM inventory_trace_events WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [input.organisationId,String(input.idempotencyKey).trim()],
    );
    if (existing.rows[0]) return { duplicate: true, traceEvent: existing.rows[0] };

    const itemResult = await client.query(
      `SELECT * FROM inventory_items WHERE organisation_id=$1 AND id=$2 AND is_active=TRUE FOR UPDATE`,
      [input.organisationId,input.itemId],
    );
    const item = itemResult.rows[0];
    if (!item) throw httpError('Article introuvable.', 404);
    if (item.tracking_mode === 'quantity') throw httpError('Cet article ne requiert pas de suivi par lot ou numéro de série.', 409);

    const locationResult = await client.query(
      `SELECT id FROM inventory_locations WHERE organisation_id=$1 AND id=$2 AND is_active=TRUE`,
      [input.organisationId,input.locationId],
    );
    if (!locationResult.rows[0]) throw httpError('Emplacement introuvable.', 404);

    let lot = null;
    if (item.tracking_mode === 'lot' || input.lotNumber) {
      if (!String(input.lotNumber || '').trim()) throw httpError('Le numéro de lot est obligatoire.');
      const lotResult = await client.query(
        `INSERT INTO inventory_lots
          (organisation_id,item_id,lot_number,supplier_id,procurement_receipt_id,manufactured_at,expires_at,unit_cost,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (organisation_id,item_id,lot_number)
         DO UPDATE SET supplier_id=COALESCE(inventory_lots.supplier_id,EXCLUDED.supplier_id),
                       procurement_receipt_id=COALESCE(inventory_lots.procurement_receipt_id,EXCLUDED.procurement_receipt_id),
                       expires_at=COALESCE(inventory_lots.expires_at,EXCLUDED.expires_at),
                       updated_at=NOW()
         RETURNING *`,
        [input.organisationId,input.itemId,String(input.lotNumber).trim(),input.supplierId || null,input.procurementReceiptId || null,input.manufacturedAt || null,input.expiresAt || null,Number(input.unitCost || 0),input.actorUserId || null],
      );
      lot = lotResult.rows[0];
      if (lot.expires_at && new Date(lot.expires_at) <= new Date()) throw httpError('Un lot déjà expiré ne peut pas être reçu comme disponible.', 409);
    }

    const serials = [];
    if (item.tracking_mode === 'serial') {
      if (!Array.isArray(input.serialNumbers) || input.serialNumbers.length !== quantity) {
        throw httpError('Un numéro de série unique est requis pour chaque unité reçue.', 409, { expected: quantity, received: input.serialNumbers?.length || 0 });
      }
      const normalized = input.serialNumbers.map((value) => String(value || '').trim());
      if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) throw httpError('Les numéros de série doivent être non vides et uniques.', 409);
      for (const serialNumber of normalized) {
        const serialResult = await client.query(
          `INSERT INTO inventory_serial_numbers
            (organisation_id,item_id,serial_number,lot_id,location_id,procurement_receipt_id,supplier_id,unit_cost,manufactured_at,expires_at,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [input.organisationId,input.itemId,serialNumber,lot?.id || null,input.locationId,input.procurementReceiptId || null,input.supplierId || null,Number(input.unitCost || 0),input.manufacturedAt || null,input.expiresAt || null,input.actorUserId || null],
        );
        serials.push(serialResult.rows[0]);
      }
    }

    if (lot) {
      await client.query(
        `INSERT INTO inventory_lot_balances (organisation_id,lot_id,item_id,location_id,quantity)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organisation_id,lot_id,location_id)
         DO UPDATE SET quantity=inventory_lot_balances.quantity+EXCLUDED.quantity,updated_at=NOW()`,
        [input.organisationId,lot.id,input.itemId,input.locationId,quantity],
      );
    }

    const traceEvent = await appendTrace(client, {
      ...input,
      lotId: lot?.id,
      eventType: 'received',
      quantity,
      metadata: { serialIds: serials.map((row) => row.id) },
    });
    return { duplicate: false, item, lot, serials, traceEvent };
  });
}

async function issueTrackedStock(input = {}) {
  const quantity = positiveQuantity(input.quantity);
  if (!input.organisationId || !input.itemId || !input.locationId || !quantity) throw httpError('Article, emplacement et quantité sont obligatoires.');
  if (!validKey(input.idempotencyKey)) throw httpError('Une clé d’idempotence valide est obligatoire.');

  return withTransaction(async (client) => {
    const itemResult = await client.query(`SELECT * FROM inventory_items WHERE organisation_id=$1 AND id=$2 FOR UPDATE`, [input.organisationId,input.itemId]);
    const item = itemResult.rows[0];
    if (!item) throw httpError('Article introuvable.', 404);

    let lot = null;
    let serials = [];
    if (item.tracking_mode === 'lot') {
      const lotResult = await client.query(
        `SELECT l.*,b.quantity,b.reserved_quantity
         FROM inventory_lots l JOIN inventory_lot_balances b ON b.organisation_id=l.organisation_id AND b.lot_id=l.id
         WHERE l.organisation_id=$1 AND l.item_id=$2 AND b.location_id=$3 AND l.id=$4 FOR UPDATE`,
        [input.organisationId,input.itemId,input.locationId,input.lotId],
      );
      lot = lotResult.rows[0];
      if (!lot) throw httpError('Lot introuvable à cet emplacement.', 404);
      if (lot.status !== 'available') throw httpError('Ce lot est bloqué.', 409, { status: lot.status });
      if (lot.expires_at && new Date(lot.expires_at) <= new Date()) throw httpError('Ce lot est expiré.', 409);
      if (quantity > Number(lot.quantity) - Number(lot.reserved_quantity)) throw httpError('Quantité disponible insuffisante dans ce lot.', 409);
      await client.query(
        `UPDATE inventory_lot_balances SET quantity=quantity-$5,updated_at=NOW()
         WHERE organisation_id=$1 AND lot_id=$2 AND item_id=$3 AND location_id=$4`,
        [input.organisationId,lot.id,input.itemId,input.locationId,quantity],
      );
    } else if (item.tracking_mode === 'serial') {
      if (!Array.isArray(input.serialNumbers) || input.serialNumbers.length !== quantity) throw httpError('Les numéros de série à sortir doivent correspondre à la quantité.', 409);
      const serialResult = await client.query(
        `SELECT * FROM inventory_serial_numbers
         WHERE organisation_id=$1 AND item_id=$2 AND location_id=$3 AND serial_number=ANY($4::varchar[])
         ORDER BY id FOR UPDATE`,
        [input.organisationId,input.itemId,input.locationId,input.serialNumbers],
      );
      serials = serialResult.rows;
      if (serials.length !== quantity) throw httpError('Un ou plusieurs numéros de série sont introuvables.', 404);
      const blocked = serials.find((row) => row.status !== 'available' || (row.expires_at && new Date(row.expires_at) <= new Date()));
      if (blocked) throw httpError('Un numéro de série est bloqué ou expiré.', 409, { serialNumber: blocked.serial_number, status: blocked.status });
      await client.query(
        `UPDATE inventory_serial_numbers
         SET status='issued',location_id=NULL,reference_type=$5,reference_id=$6,updated_at=NOW()
         WHERE organisation_id=$1 AND item_id=$2 AND id=ANY($3::bigint[]) AND status='available'`,
        [input.organisationId,input.itemId,serials.map((row) => row.id),input.locationId,input.referenceType || null,input.referenceId || null],
      );
    }

    const traceEvent = await appendTrace(client, {
      ...input,
      lotId: lot?.id,
      eventType: 'issued',
      quantity,
      metadata: { serialIds: serials.map((row) => row.id) },
    });
    return { item, lot, serials, traceEvent };
  });
}

async function changeLotStatus(input = {}) {
  const allowed = { quarantine: 'quarantined', release: 'available', recall: 'recalled' };
  const status = allowed[input.action];
  if (!status || !String(input.reason || '').trim()) throw httpError('Action et raison sont obligatoires.');
  if (!validKey(input.idempotencyKey)) throw httpError('Une clé d’idempotence valide est obligatoire.');
  return withTransaction(async (client) => {
    const lotResult = await client.query(
      `UPDATE inventory_lots SET status=$4,
        quarantine_reason=CASE WHEN $4='quarantined' THEN $5 ELSE quarantine_reason END,
        recall_reason=CASE WHEN $4='recalled' THEN $5 ELSE recall_reason END,
        updated_at=NOW()
       WHERE organisation_id=$1 AND id=$2 AND item_id=$3 RETURNING *`,
      [input.organisationId,input.lotId,input.itemId,status,String(input.reason).trim()],
    );
    const lot = lotResult.rows[0];
    if (!lot) throw httpError('Lot introuvable.', 404);
    await client.query(
      `UPDATE inventory_serial_numbers SET status=$4,updated_at=NOW()
       WHERE organisation_id=$1 AND lot_id=$2 AND item_id=$3 AND status NOT IN ('issued','returned')`,
      [input.organisationId,input.lotId,input.itemId,status === 'available' ? 'available' : status],
    );
    const eventType = input.action === 'quarantine' ? 'quarantined' : input.action === 'release' ? 'released_from_quarantine' : 'recalled';
    const traceEvent = await appendTrace(client, { ...input, eventType, quantity: null });
    return { lot, traceEvent };
  });
}

async function openRecall(input = {}) {
  if (!input.organisationId || !input.itemId || !String(input.recallNumber || '').trim() || !String(input.reason || '').trim()) throw httpError('Numéro, article et raison du rappel sont obligatoires.');
  return withTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO inventory_recalls (organisation_id,recall_number,item_id,lot_id,reason,opened_by,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [input.organisationId,String(input.recallNumber).trim(),input.itemId,input.lotId || null,String(input.reason).trim(),input.actorUserId || null,input.notes || null],
    );
    const recall = result.rows[0];
    if (input.lotId) {
      await client.query(`UPDATE inventory_lots SET status='recalled',recall_reason=$4,updated_at=NOW() WHERE organisation_id=$1 AND id=$2 AND item_id=$3`, [input.organisationId,input.lotId,input.itemId,input.reason]);
      await client.query(`UPDATE inventory_serial_numbers SET status='recalled',updated_at=NOW() WHERE organisation_id=$1 AND lot_id=$2 AND item_id=$3 AND status NOT IN ('issued','returned')`, [input.organisationId,input.lotId,input.itemId]);
    }
    return { recall };
  });
}

async function listExpiryAlerts(db, organisationId, { days = 30 } = {}) {
  const horizon = Math.max(0, Math.min(Number(days) || 30, 365));
  const { rows } = await db.query(
    `SELECT l.*,i.sku,i.name,
            COALESCE(SUM(b.quantity),0)::numeric quantity_on_hand,
            (l.expires_at-CURRENT_DATE)::integer days_remaining
     FROM inventory_lots l
     JOIN inventory_items i ON i.organisation_id=l.organisation_id AND i.id=l.item_id
     LEFT JOIN inventory_lot_balances b ON b.organisation_id=l.organisation_id AND b.lot_id=l.id
     WHERE l.organisation_id=$1 AND l.expires_at IS NOT NULL
       AND l.expires_at<=CURRENT_DATE+$2::integer
       AND l.status IN ('available','quarantined')
     GROUP BY l.id,i.sku,i.name
     ORDER BY l.expires_at,l.id`,
    [organisationId,horizon],
  );
  return rows;
}

async function traceItem(db, organisationId, { itemId, lotId, serialNumber } = {}) {
  const { rows } = await db.query(
    `SELECT e.*,l.lot_number,s.serial_number,sl.name location_name
     FROM inventory_trace_events e
     LEFT JOIN inventory_lots l ON l.organisation_id=e.organisation_id AND l.id=e.lot_id
     LEFT JOIN inventory_serial_numbers s ON s.organisation_id=e.organisation_id AND s.id=e.serial_id
     LEFT JOIN inventory_locations sl ON sl.organisation_id=e.organisation_id AND sl.id=e.location_id
     WHERE e.organisation_id=$1
       AND ($2::bigint IS NULL OR e.item_id=$2)
       AND ($3::bigint IS NULL OR e.lot_id=$3)
       AND ($4::varchar IS NULL OR s.serial_number=$4)
     ORDER BY e.occurred_at,e.id`,
    [organisationId,itemId || null,lotId || null,serialNumber || null],
  );
  return rows;
}

module.exports = { positiveQuantity, validKey, receiveTrackedStock, issueTrackedStock, changeLotStatus, openRecall, listExpiryAlerts, traceItem };
