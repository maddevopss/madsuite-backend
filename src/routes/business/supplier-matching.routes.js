const router = require('express').Router();
const db = require('../../../db');
const requireRole = require('../../middleware/requireRole');
const service = require('../../services/business/supplier-matching.service');
const supplierApprovalPaymentRoutes = require('./supplier-approval-payment.routes');

router.use('/approval-payments', supplierApprovalPaymentRoutes);

router.get('/policies', async (req, res, next) => {
  try { const { rows } = await req.db.query('SELECT * FROM supplier_matching_policies WHERE organisation_id=$1 ORDER BY is_default DESC, name', [req.organisationId]); return res.json({ policies: rows }); }
  catch (error) { return next(error); }
});
router.post('/policies', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body;
    const { rows } = await req.db.query(`INSERT INTO supplier_matching_policies
      (organisation_id,name,matching_mode,price_tolerance_percent,quantity_tolerance_percent,tax_tolerance_amount,auto_approve_within_tolerance,is_default)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [req.organisationId, body.name, body.matchingMode || 'three_way', body.priceTolerancePercent ?? 2, body.quantityTolerancePercent ?? 0, body.taxToleranceAmount ?? 0.05, body.autoApproveWithinTolerance === true, body.isDefault === true]);
    return res.status(201).json({ policy: rows[0] });
  } catch (error) { return next(error); }
});
router.post('/bills/:billId/run', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await service.runMatching({ organisationId: req.organisationId, billId: req.params.billId, policyId: req.body.policyId, actorUserId: req.user?.id, idempotencyKey: req.get('Idempotency-Key') || req.body.idempotencyKey });
    if (!result) return res.status(404).json({ message: 'Facture fournisseur introuvable.' });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});
router.get('/bills/:billId/exceptions', async (req, res, next) => {
  try { const { rows } = await req.db.query('SELECT * FROM supplier_matching_exceptions WHERE organisation_id=$1 AND supplier_bill_id=$2 ORDER BY created_at DESC', [req.organisationId, req.params.billId]); return res.json({ exceptions: rows }); }
  catch (error) { return next(error); }
});
router.post('/exceptions/:exceptionId/resolve', requireRole('admin'), async (req, res, next) => {
  try {
    const exception = await service.resolveException({ organisationId: req.organisationId, exceptionId: req.params.exceptionId, status: req.body.status, explanation: req.body.explanation, evidence: req.body.evidence, actorUserId: req.user?.id });
    if (!exception) return res.status(404).json({ message: 'Écart introuvable ou déjà résolu.' });
    return res.json({ exception });
  } catch (error) { return next(error); }
});
router.get('/exceptions', async (req, res, next) => {
  try {
    const status = req.query.status || 'open';
    const { rows } = await db.pool.query(`SELECT e.*, b.bill_number, s.name supplier_name FROM supplier_matching_exceptions e
      JOIN supplier_bills b ON b.organisation_id=e.organisation_id AND b.id=e.supplier_bill_id
      JOIN suppliers s ON s.organisation_id=b.organisation_id AND s.id=b.supplier_id
      WHERE e.organisation_id=$1 AND ($2='' OR e.status=$2) ORDER BY e.created_at DESC`, [req.organisationId, status]);
    return res.json({ exceptions: rows });
  } catch (error) { return next(error); }
});

module.exports = router;
