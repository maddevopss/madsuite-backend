const inventoryTransactionService = require('./inventory-transaction.service');

function httpError(message, statusCode = 400, details) {
  return Object.assign(new Error(message), { statusCode, details });
}

function positiveQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return Number(quantity.toFixed(3));
}

function validKey(value) {
  return Boolean(value && String(value).trim().length >= 8);
}

async function getAvailability(db, organisationId, { itemId, locationId } = {}) {
  const { rows } = await db.query(
    `SELECT b.item_id,b.location_id,i.sku,i.name,l.code location_code,l.name location_name,
            b.quantity::numeric quantity_on_hand,
            COALESCE(r.reserved_quantity,0)::numeric quantity_reserved,
            (b.quantity-COALESCE(r.reserved_quantity,0))::numeric quantity_available,
            b.average_cost::numeric average_cost,
            b.inventory_value::numeric inventory_value
     FROM inventory_balances b
     JOIN inventory_items i ON i.organisation_id=b.organisation_id AND i.id=b.item_id
     JOIN inventory_locations l ON l.organisation_id=b.organisation_id AND l.id=b.location_id
     LEFT JOIN (
       SELECT organisation_id,item_id,location_id,SUM(quantity) reserved_quantity
       FROM inventory_reservations
       WHERE status='active' AND (expires_at IS NULL OR expires_at>NOW())
       GROUP BY organisation_id,item_id,location_id
     ) r ON r.organisation_id=b.organisation_id AND r.item_id=b.item_id AND r.location_id=b.location_id
     WHERE b.organisation_id=$1
       AND ($2::bigint IS NULL OR b.item_id=$2)
       AND ($3::bigint IS NULL OR b.location_id=$3)
     ORDER BY i.name,l.name`,
    [organisationId, itemId || null, locationId || null],
  );
  return rows;
}

async function reserveStock(db, organisationId, actorUserId, input = {}) {
  const quantity = positiveQuantity(input.quantity);
  if (!input.itemId || !input.locationId || !quantity) throw httpError('Article, emplacement et quantité positive sont obligatoires.');
  if (!input.referenceType || !input.referenceId) throw httpError('La source de la réservation est obligatoire.');
  if (!validKey(input.idempotencyKey)) throw httpError('Une clé d’idempotence valide est obligatoire.');

  await db.query('BEGIN');
  try {
    const existing = await db.query(
      `SELECT * FROM inventory_reservations WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [organisationId, String(input.idempotencyKey).trim()],
    );
    if (existing.rows[0]) {
      await db.query('COMMIT');
      return { duplicate: true, reservation: existing.rows[0] };
    }

    const balance = await db.query(
      `SELECT * FROM inventory_balances
       WHERE organisation_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`,
      [organisationId, input.itemId, input.locationId],
    );
    if (!balance.rows[0]) throw httpError('Solde d’inventaire introuvable.', 404);

    const reserved = await db.query(
      `SELECT COALESCE(SUM(quantity),0)::numeric quantity
       FROM inventory_reservations
       WHERE organisation_id=$1 AND item_id=$2 AND location_id=$3
         AND status='active' AND (expires_at IS NULL OR expires_at>NOW())`,
      [organisationId, input.itemId, input.locationId],
    );
    const available = Number(balance.rows[0].quantity) - Number(reserved.rows[0].quantity);
    if (quantity > available) throw httpError('Stock disponible insuffisant pour cette réservation.', 409, { available, requested: quantity });

    const inserted = await db.query(
      `INSERT INTO inventory_reservations
       (organisation_id,item_id,location_id,quantity,reference_type,reference_id,idempotency_key,expires_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [organisationId,input.itemId,input.locationId,quantity,String(input.referenceType),String(input.referenceId),String(input.idempotencyKey).trim(),input.expiresAt || null,actorUserId || null],
    );
    await db.query('COMMIT');
    return { duplicate: false, reservation: inserted.rows[0], availability: { quantityOnHand: Number(balance.rows[0].quantity), quantityReserved: Number(reserved.rows[0].quantity) + quantity, quantityAvailable: available - quantity } };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function transitionReservation(db, organisationId, actorUserId, reservationId, action) {
  const mapping = {
    release: { from: 'active', to: 'released', stamp: 'released_at' },
    consume: { from: 'active', to: 'consumed', stamp: 'consumed_at' },
    cancel: { from: 'active', to: 'cancelled', stamp: 'released_at' },
  };
  const transition = mapping[action];
  if (!transition) throw httpError('Action de réservation invalide.');
  const { rows } = await db.query(
    `UPDATE inventory_reservations
     SET status=$4,${transition.stamp}=NOW(),updated_at=NOW()
     WHERE organisation_id=$1 AND id=$2 AND status=$3
     RETURNING *`,
    [organisationId,reservationId,transition.from,transition.to],
  );
  if (!rows[0]) throw httpError('Réservation introuvable ou déjà traitée.', 409);
  return { reservation: rows[0], actorUserId };
}

async function createCountSession(db, organisationId, actorUserId, input = {}) {
  if (!input.locationId || !String(input.code || '').trim()) throw httpError('Le code et l’emplacement du comptage sont obligatoires.');
  await db.query('BEGIN');
  try {
    const session = await db.query(
      `INSERT INTO inventory_count_sessions
       (organisation_id,location_id,code,status,freeze_movements,created_by,notes)
       VALUES ($1,$2,$3,'counting',$4,$5,$6) RETURNING *`,
      [organisationId,input.locationId,String(input.code).trim(),Boolean(input.freezeMovements),actorUserId || null,input.notes || null],
    );
    await db.query(
      `INSERT INTO inventory_count_lines
       (organisation_id,session_id,item_id,expected_quantity,unit_cost)
       SELECT b.organisation_id,$2,b.item_id,b.quantity,b.average_cost
       FROM inventory_balances b
       WHERE b.organisation_id=$1 AND b.location_id=$3
       ON CONFLICT (organisation_id,session_id,item_id) DO NOTHING`,
      [organisationId,session.rows[0].id,input.locationId],
    );
    await db.query('COMMIT');
    return { session: session.rows[0] };
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function recordCount(db, organisationId, actorUserId, sessionId, input = {}) {
  const counted = Number(input.countedQuantity);
  if (!input.itemId || !Number.isFinite(counted) || counted < 0) throw httpError('Article et quantité comptée valide sont obligatoires.');
  const { rows } = await db.query(
    `UPDATE inventory_count_lines l
     SET counted_quantity=$4,
         variance_quantity=ROUND(($4-expected_quantity)::numeric,3),
         variance_value=ROUND((($4-expected_quantity)*unit_cost)::numeric,4),
         count_sequence=count_sequence+1,
         counted_by=$5,
         counted_at=NOW(),note=$6,updated_at=NOW()
     FROM inventory_count_sessions s
     WHERE l.organisation_id=$1 AND l.session_id=$2 AND l.item_id=$3
       AND s.organisation_id=l.organisation_id AND s.id=l.session_id AND s.status='counting'
     RETURNING l.*`,
    [organisationId,sessionId,input.itemId,counted,actorUserId || null,input.note || null],
  );
  if (!rows[0]) throw httpError('Session de comptage introuvable ou non modifiable.', 409);
  return { line: rows[0] };
}

async function submitCountSession(db, organisationId, actorUserId, sessionId) {
  const missing = await db.query(
    `SELECT COUNT(*)::integer count FROM inventory_count_lines
     WHERE organisation_id=$1 AND session_id=$2 AND counted_quantity IS NULL`,
    [organisationId,sessionId],
  );
  if (missing.rows[0].count > 0) throw httpError('Tous les articles doivent être comptés avant la soumission.', 409, { missing: missing.rows[0].count });
  const { rows } = await db.query(
    `UPDATE inventory_count_sessions SET status='review',submitted_at=NOW(),submitted_by=$3,updated_at=NOW()
     WHERE organisation_id=$1 AND id=$2 AND status='counting' RETURNING *`,
    [organisationId,sessionId,actorUserId || null],
  );
  if (!rows[0]) throw httpError('Session de comptage introuvable ou déjà soumise.', 409);
  return { session: rows[0] };
}

async function approveCountSession(db, organisationId, actorUserId, sessionId, { idempotencyPrefix } = {}) {
  if (!validKey(idempotencyPrefix)) throw httpError('Un préfixe d’idempotence valide est obligatoire.');
  const session = await db.query(
    `SELECT * FROM inventory_count_sessions WHERE organisation_id=$1 AND id=$2 AND status='review' FOR UPDATE`,
    [organisationId,sessionId],
  );
  if (!session.rows[0]) throw httpError('Session de comptage introuvable ou non prête.', 409);
  if (Number(session.rows[0].submitted_by) === Number(actorUserId)) throw httpError('La personne qui soumet ne peut pas approuver son propre comptage.', 403);

  const lines = await db.query(
    `SELECT * FROM inventory_count_lines WHERE organisation_id=$1 AND session_id=$2 ORDER BY id`,
    [organisationId,sessionId],
  );
  const adjustments = [];
  for (const line of lines.rows) {
    const variance = Number(line.variance_quantity || 0);
    if (!variance) continue;
    const result = await inventoryTransactionService.postInventoryTransaction({
      organisationId,
      actorUserId,
      type: 'adjustment',
      itemId: line.item_id,
      locationId: session.rows[0].location_id,
      quantity: Math.abs(variance),
      unitCost: Number(line.unit_cost || 0),
      direction: variance > 0 ? 'increase' : 'decrease',
      reason: `Inventaire physique ${session.rows[0].code}`,
      referenceType: 'inventory_count_session',
      referenceId: String(sessionId),
      idempotencyKey: `${idempotencyPrefix}:${line.id}`,
    });
    adjustments.push(result.inventoryTransaction);
    await db.query(
      `UPDATE inventory_count_lines SET adjustment_transaction_id=$4,updated_at=NOW()
       WHERE organisation_id=$1 AND session_id=$2 AND id=$3`,
      [organisationId,sessionId,line.id,result.inventoryTransaction.id],
    );
  }
  const approved = await db.query(
    `UPDATE inventory_count_sessions SET status='approved',approved_at=NOW(),approved_by=$3,updated_at=NOW()
     WHERE organisation_id=$1 AND id=$2 AND status='review' RETURNING *`,
    [organisationId,sessionId,actorUserId || null],
  );
  return { session: approved.rows[0], adjustments };
}

module.exports = {
  positiveQuantity,
  validKey,
  getAvailability,
  reserveStock,
  transitionReservation,
  createCountSession,
  recordCount,
  submitCountSession,
  approveCountSession,
};
