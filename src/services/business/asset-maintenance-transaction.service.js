const { organisationValue } = require('../../utils/organisationScope');
const { executeTransaction, registerPolicy } = require('./transaction-engine.service');
const { appendEvent } = require('./business-event.service');
const { persistTrustAssessment, persistGraphEdges } = require('./trust-persistence.service');

const ASSET_CREATE_POLICY = 'assets.record.create@1';
const WORK_ORDER_CREATE_POLICY = 'assets.work_order.create@1';
const WORK_ORDER_TRANSITION_POLICY = 'assets.work_order.transition@1';
const USAGE_READING_POLICY = 'assets.usage.reading@1';

const validIdempotency = (value) => Boolean(value && String(value).trim().length >= 8);
const hasEvidence = (value) => Array.isArray(value) && value.length > 0;
const nonNegativeMoney = (value) => value == null || (Number.isFinite(Number(value)) && Number(value) >= 0);

registerPolicy('assets.record.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey)) return { allowed: false, statusCode: 400, code: 'assets.idempotency_invalid' };
  if (!input?.assetCode || !input?.name || !input?.assetType) return { allowed: false, statusCode: 400, code: 'assets.identity_required' };
  if (!nonNegativeMoney(input.acquisitionCost) || !nonNegativeMoney(input.residualValue)) return { allowed: false, statusCode: 400, code: 'assets.value_invalid' };
  return { allowed: true, code: 'assets.record.valid' };
});

registerPolicy('assets.work_order.create', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey) || !input?.assetId || !input?.workOrderNumber || !input?.workType || !String(input.description || '').trim()) return { allowed: false, statusCode: 400, code: 'assets.work_order_incomplete' };
  return { allowed: true };
});

registerPolicy('assets.work_order.transition', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey) || !input?.workOrderId || !input?.action) return { allowed: false, statusCode: 400, code: 'assets.transition_invalid' };
  if (['completed','verified'].includes(input.action) && !hasEvidence(input.evidence)) return { allowed: false, statusCode: 400, code: 'assets.completion_evidence_required', reason: 'Une complétion ou vérification exige une preuve.' };
  if (input.action === 'completed' && !String(input.reason || '').trim()) return { allowed: false, statusCode: 400, code: 'assets.completion_reason_required' };
  if (input.action === 'cancelled' && !String(input.reason || '').trim()) return { allowed: false, statusCode: 400, code: 'assets.cancellation_reason_required' };
  if (![input.labourCost,input.partsCost,input.externalCost].every(nonNegativeMoney)) return { allowed: false, statusCode: 400, code: 'assets.cost_invalid' };
  return { allowed: true };
});

registerPolicy('assets.usage.reading', '1', ({ input, idempotencyKey }) => {
  if (!validIdempotency(idempotencyKey) || !input?.assetId || !input?.readingUnit || !input?.measuredAt) return { allowed: false, statusCode: 400, code: 'assets.reading_incomplete' };
  if (!Number.isFinite(Number(input.readingValue)) || Number(input.readingValue) < 0) return { allowed: false, statusCode: 400, code: 'assets.reading_invalid' };
  return { allowed: true };
});

async function transitionWorkOrder({ organisationId, id, action, reason, evidence = [], findings = [], labourCost = 0, partsCost = 0, externalCost = 0, idempotencyKey, createdBy }) {
  const input = { workOrderId: id, action, reason, evidence, findings, labourCost, partsCost, externalCost };
  const tx = await executeTransaction({
    type: 'assets.work_order.transition', organisationId: organisationValue(organisationId), actorUserId: createdBy, idempotencyKey, policies: [WORK_ORDER_TRANSITION_POLICY], input,
    execute: async ({ client, transactionId, correlationId, organisationId: orgId, actorUserId }) => {
      const { rows } = await client.query('SELECT * FROM asset_work_orders WHERE organisation_id=$1 AND id=$2 FOR UPDATE', [orgId, id]);
      const current = rows[0];
      if (!current) return null;
      const updated = await client.query(
        `UPDATE asset_work_orders SET
           status=$3,
           evidence=$5,
           findings=$6,
           labour_cost=$7,
           parts_cost=$8,
           external_cost=$9,
           ct_mad_transaction_id=$10,
           correlation_id=$11,
           started_at = CASE WHEN $3='in_progress' THEN COALESCE(started_at,NOW()) ELSE started_at END,
           completed_at = CASE WHEN $3='completed' THEN NOW() ELSE completed_at END,
           verified_at = CASE WHEN $3='verified' THEN NOW() ELSE verified_at END,
           completion_reason = CASE WHEN $3='completed' THEN $4::text ELSE completion_reason END,
           cancellation_reason = CASE WHEN $3='cancelled' THEN $4::text ELSE cancellation_reason END
         WHERE organisation_id=$1 AND id=$2 RETURNING *`,
        [orgId,id,action,reason||null,JSON.stringify(evidence),JSON.stringify(findings),labourCost,partsCost,externalCost,transactionId,correlationId],
      );
      const event = await appendEvent(client, { organisationId: orgId, eventType: `assets.work_order.${action}`, aggregateType: 'asset_work_order', aggregateId: id, actorUserId, correlationId, payload: { assetId: current.asset_id, reason: reason || null, evidenceCount: evidence.length } });
      const trust = await persistTrustAssessment(client, { organisationId: orgId, transactionId, correlationId, checks: [{ code: 'assets.completion_evidenced', passed: !['completed','verified'].includes(action) || hasEvidence(evidence), evidence }, { code: 'assets.costs_non_negative', passed: [labourCost,partsCost,externalCost].every(nonNegativeMoney), evidence: [{ labourCost,partsCost,externalCost }] }] });
      const graph = await persistGraphEdges(client, { organisationId: orgId, transactionId, correlationId, edges: [{ from: { type: 'asset_work_order', id }, relation: 'maintains', to: { type: 'asset', id: current.asset_id }, provenance: { eventId: event.event_id } }] });
      return { workOrder: updated.rows[0], event, trust, graph };
    },
  });
  return tx.result ? { ...tx.result, ct_mad: { transactionId: tx.transactionId, correlationId: tx.correlationId, policies: tx.policyResults } } : null;
}

module.exports = { ASSET_CREATE_POLICY, WORK_ORDER_CREATE_POLICY, WORK_ORDER_TRANSITION_POLICY, USAGE_READING_POLICY, validIdempotency, hasEvidence, nonNegativeMoney, transitionWorkOrder };
