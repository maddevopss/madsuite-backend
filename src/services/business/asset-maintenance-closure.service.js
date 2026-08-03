const { organisationValue } = require('../../utils/organisationScope');

function hasEvidence(value) {
  return Array.isArray(value) && value.length > 0;
}

function validateClosure({ workOrder, returnToServiceCheck, labour = [], parts = [] }) {
  if (!workOrder) return { allowed: false, code: 'assets.work_order_not_found' };
  if (workOrder.status !== 'verified') return { allowed: false, code: 'assets.work_order_not_verified' };
  if (!String(workOrder.diagnosis || '').trim()) return { allowed: false, code: 'assets.diagnosis_required' };
  if (!String(workOrder.resolution || '').trim()) return { allowed: false, code: 'assets.resolution_required' };
  if (!hasEvidence(workOrder.evidence)) return { allowed: false, code: 'assets.closure_evidence_required' };
  if (!returnToServiceCheck) return { allowed: false, code: 'assets.return_to_service_check_required' };
  if (!returnToServiceCheck.safe_to_operate) return { allowed: false, code: 'assets.asset_not_safe_to_operate' };
  if (!hasEvidence(returnToServiceCheck.evidence)) return { allowed: false, code: 'assets.safety_evidence_required' };
  if (workOrder.parts_cost > 0 && parts.length === 0) return { allowed: false, code: 'assets.parts_trace_required' };
  if (workOrder.labour_cost > 0 && labour.length === 0) return { allowed: false, code: 'assets.labour_trace_required' };
  return { allowed: true, code: 'assets.closure_allowed' };
}

async function closeWorkOrder({ db, organisationId, workOrderId, closedBy, reason }) {
  const orgId = organisationValue(organisationId);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(orgId)]);
    const workOrder = (await client.query('SELECT * FROM asset_work_orders WHERE organisation_id=$1 AND id=$2 FOR UPDATE', [orgId, workOrderId])).rows[0];
    const returnToServiceCheck = (await client.query('SELECT * FROM asset_return_to_service_checks WHERE organisation_id=$1 AND work_order_id=$2', [orgId, workOrderId])).rows[0];
    const labour = (await client.query('SELECT * FROM asset_work_order_labour WHERE organisation_id=$1 AND work_order_id=$2', [orgId, workOrderId])).rows;
    const parts = (await client.query('SELECT * FROM asset_work_order_parts WHERE organisation_id=$1 AND work_order_id=$2', [orgId, workOrderId])).rows;
    const decision = validateClosure({ workOrder, returnToServiceCheck, labour, parts });
    if (!decision.allowed) {
      const error = new Error(decision.code);
      error.statusCode = 409;
      error.code = decision.code;
      throw error;
    }
    const updated = (await client.query(`UPDATE asset_work_orders SET status='completed',closed_at=NOW(),closed_by=$3,completion_reason=COALESCE($4,completion_reason),safety_lock=FALSE WHERE organisation_id=$1 AND id=$2 RETURNING *`, [orgId, workOrderId, closedBy, reason || null])).rows[0];
    await client.query(`INSERT INTO asset_work_order_status_events (organisation_id,work_order_id,from_status,to_status,reason,evidence,actor_user_id) VALUES ($1,$2,'verified','completed',$3,$4,$5)`, [orgId, workOrderId, reason || null, JSON.stringify(returnToServiceCheck.evidence), closedBy]);
    await client.query(`UPDATE asset_records SET status='active',updated_at=NOW() WHERE organisation_id=$1 AND id=$2 AND status='out_of_service'`, [orgId, updated.asset_id]);
    await client.query('COMMIT');
    return { workOrder: updated, closureDecision: decision };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { hasEvidence, validateClosure, closeWorkOrder };
