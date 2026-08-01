const db = require('../../../db');

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : value;
}

async function createSupplier({ organisationId, actorUserId, payload }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);

    const idempotencyKey = clean(payload.idempotencyKey);
    if (!idempotencyKey) throw httpError('supplier.idempotency_key_required', 400);

    const duplicate = await client.query(
      'SELECT * FROM suppliers WHERE organisation_id=$1 AND idempotency_key=$2',
      [organisationId, idempotencyKey],
    );
    if (duplicate.rows[0]) {
      await client.query('ROLLBACK');
      return { supplier: duplicate.rows[0], duplicate: true };
    }

    const supplierNumber = clean(payload.supplierNumber);
    const legalName = clean(payload.legalName || payload.name);
    if (!supplierNumber || !legalName) throw httpError('supplier.number_and_legal_name_required', 400);

    const inserted = await client.query(
      `INSERT INTO suppliers
       (organisation_id,supplier_number,name,legal_name,trade_name,status,currency,language,preferred,category,
        tax_numbers,payment_terms,notes,compliance_status,idempotency_key,created_by,updated_by,
        contact_name,email,phone,tax_number,payment_terms_days,address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        organisationId,
        supplierNumber,
        legalName,
        legalName,
        clean(payload.tradeName) || legalName,
        payload.status || 'active',
        payload.currency || 'CAD',
        payload.language || 'fr-CA',
        Boolean(payload.preferred),
        clean(payload.category) || null,
        payload.taxNumbers || {},
        payload.paymentTerms || { days: Number(payload.paymentTermsDays || 30) },
        clean(payload.notes) || null,
        payload.complianceStatus || 'pending',
        idempotencyKey,
        actorUserId || null,
        clean(payload.contactName) || null,
        clean(payload.email) || null,
        clean(payload.phone) || null,
        clean(payload.taxNumber) || null,
        Number(payload.paymentTermsDays || payload.paymentTerms?.days || 30),
        payload.address || {},
      ],
    );

    const supplier = inserted.rows[0];
    await client.query(
      `INSERT INTO supplier_audit_events
       (organisation_id,supplier_id,event_type,actor_user_id,reason,changes,idempotency_key)
       VALUES ($1,$2,'supplier_created',$3,$4,$5,$6)`,
      [organisationId, supplier.id, actorUserId || null, clean(payload.reason) || 'Création du dossier fournisseur', payload, `${idempotencyKey}:audit`],
    );

    await client.query('COMMIT');
    return { supplier, duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw httpError('supplier.number_already_exists', 409);
    throw error;
  } finally {
    client.release();
  }
}

async function changeStatus({ organisationId, supplierId, status, reason, actorUserId, idempotencyKey }) {
  if (!['prospect', 'active', 'on_hold', 'blocked', 'inactive'].includes(status)) {
    throw httpError('supplier.status_invalid', 400);
  }
  if (!clean(reason)) throw httpError('supplier.status_reason_required', 400);
  if (!clean(idempotencyKey)) throw httpError('supplier.idempotency_key_required', 400);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationId)]);
    const existingAudit = await client.query(
      'SELECT id FROM supplier_audit_events WHERE organisation_id=$1 AND idempotency_key=$2',
      [organisationId, idempotencyKey],
    );
    if (existingAudit.rows[0]) {
      const current = await client.query('SELECT * FROM suppliers WHERE organisation_id=$1 AND id=$2', [organisationId, supplierId]);
      await client.query('ROLLBACK');
      return { supplier: current.rows[0], duplicate: true };
    }

    const current = await client.query(
      'SELECT * FROM suppliers WHERE organisation_id=$1 AND id=$2 FOR UPDATE',
      [organisationId, supplierId],
    );
    if (!current.rows[0]) throw httpError('supplier.not_found', 404);

    const updated = await client.query(
      `UPDATE suppliers SET status=$3,is_active=($3='active'),updated_by=$4,updated_at=NOW()
       WHERE organisation_id=$1 AND id=$2 RETURNING *`,
      [organisationId, supplierId, status, actorUserId || null],
    );
    await client.query(
      `INSERT INTO supplier_audit_events
       (organisation_id,supplier_id,event_type,actor_user_id,reason,changes,idempotency_key)
       VALUES ($1,$2,'status_changed',$3,$4,$5,$6)`,
      [organisationId, supplierId, actorUserId || null, clean(reason), { from: current.rows[0].status, to: status }, idempotencyKey],
    );
    await client.query('COMMIT');
    return { supplier: updated.rows[0], duplicate: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { createSupplier, changeStatus };
