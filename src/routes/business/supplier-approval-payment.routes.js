const router = require('express').Router();
const requireRole = require('../../middleware/requireRole');
const service = require('../../services/business/supplier-approval-payment.service');

router.get('/policies', async (req, res, next) => {
  try { const { rows } = await req.db.query('SELECT * FROM supplier_approval_policies WHERE organisation_id=$1 ORDER BY minimum_amount,name', [req.organisationId]); return res.json({ policies: rows }); }
  catch (error) { return next(error); }
});

router.post('/policies', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await req.db.query(`INSERT INTO supplier_approval_policies
      (organisation_id,name,category,minimum_amount,maximum_amount,required_approvals,require_distinct_requester,require_distinct_payer)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.organisationId,b.name,b.category || null,b.minimumAmount || 0,b.maximumAmount || null,b.requiredApprovals || 1,b.requireDistinctRequester !== false,b.requireDistinctPayer !== false]);
    return res.status(201).json({ policy: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/bills/:billId/request', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await service.requestApproval({ organisationId:req.organisationId,billId:req.params.billId,policyId:req.body.policyId,actorUserId:req.user?.id,idempotencyKey:req.get('Idempotency-Key') || req.body.idempotencyKey });
    if (!result) return res.status(404).json({ message:'Facture fournisseur introuvable.' });
    return res.status(201).json(result);
  } catch (error) { return next(error); }
});

router.post('/approvals/:approvalId/decision', requireRole('admin'), async (req, res, next) => {
  try {
    const approval = await service.decideApproval({ organisationId:req.organisationId,approvalId:req.params.approvalId,decision:req.body.decision,reason:req.body.reason,actorUserId:req.user?.id });
    if (!approval) return res.status(404).json({ message:'Approbation introuvable.' });
    return res.json({ approval });
  } catch (error) { return next(error); }
});

router.get('/batches', async (req, res, next) => {
  try { const { rows } = await req.db.query('SELECT * FROM supplier_payment_batches WHERE organisation_id=$1 ORDER BY scheduled_for DESC,id DESC', [req.organisationId]); return res.json({ batches: rows }); }
  catch (error) { return next(error); }
});

router.post('/batches', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await service.createPaymentBatch({ organisationId:req.organisationId,payload:req.body,actorUserId:req.user?.id });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.post('/batches/:batchId/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const { rows } = await req.db.query(`UPDATE supplier_payment_batches SET status='approved',approved_by=$3,updated_at=NOW()
      WHERE organisation_id=$1 AND id=$2 AND status='ready' AND prepared_by IS DISTINCT FROM $3 RETURNING *`, [req.organisationId,req.params.batchId,req.user?.id || null]);
    if (!rows[0]) return res.status(409).json({ message:'Lot introuvable, non prêt ou séparation des rôles non respectée.' });
    return res.json({ batch: rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
