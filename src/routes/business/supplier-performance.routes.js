const router = require('express').Router();
const requireRole = require('../../middleware/requireRole');
const service = require('../../services/business/supplier-performance.service');

router.get('/snapshots', async (req, res, next) => {
  try {
    const supplierId = req.query.supplierId || null;
    const { rows } = await req.db.query(`SELECT p.*,s.supplier_number,s.legal_name FROM supplier_performance_snapshots p
      JOIN suppliers s ON s.organisation_id=p.organisation_id AND s.id=p.supplier_id
      WHERE p.organisation_id=$1 AND ($2::bigint IS NULL OR p.supplier_id=$2)
      ORDER BY p.period_end DESC,p.overall_score DESC`, [req.organisationId,supplierId]);
    return res.json({ snapshots: rows });
  } catch (error) { return next(error); }
});

router.post('/suppliers/:supplierId/snapshots', requireRole('admin'), async (req, res, next) => {
  try {
    const snapshot = await service.createSnapshot({ organisationId:req.organisationId,supplierId:req.params.supplierId,periodStart:req.body.periodStart,periodEnd:req.body.periodEnd });
    if (!snapshot) return res.status(404).json({ message:'Fournisseur introuvable.' });
    return res.status(201).json({ snapshot });
  } catch (error) { return next(error); }
});

router.get('/incidents', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const { rows } = await req.db.query(`SELECT i.*,s.supplier_number,s.legal_name FROM supplier_incidents i
      JOIN suppliers s ON s.organisation_id=i.organisation_id AND s.id=i.supplier_id
      WHERE i.organisation_id=$1 AND ($2::text IS NULL OR i.status=$2) ORDER BY i.occurred_at DESC`, [req.organisationId,status]);
    return res.json({ incidents: rows });
  } catch (error) { return next(error); }
});

router.post('/incidents', requireRole('admin'), async (req, res, next) => {
  try {
    const b = req.body;
    const { rows } = await req.db.query(`INSERT INTO supplier_incidents
      (organisation_id,supplier_id,incident_number,incident_type,severity,description,status,occurred_at,due_at,evidence,owner_user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [req.organisationId,b.supplierId,b.incidentNumber,b.incidentType,b.severity,b.description,b.status || 'open',b.occurredAt || new Date(),b.dueAt || null,b.evidence || [],b.ownerUserId || req.user?.id || null]);
    return res.status(201).json({ incident: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/incidents/:incidentId/resolve', requireRole('admin'), async (req, res, next) => {
  try {
    if (!String(req.body.correctiveAction || '').trim()) return res.status(400).json({ message:'L’action corrective est obligatoire.' });
    const { rows } = await req.db.query(`UPDATE supplier_incidents SET status='resolved',corrective_action=$3,evidence=$4,resolved_at=NOW()
      WHERE organisation_id=$1 AND id=$2 AND status<>'closed' RETURNING *`, [req.organisationId,req.params.incidentId,req.body.correctiveAction.trim(),req.body.evidence || []]);
    if (!rows[0]) return res.status(404).json({ message:'Incident introuvable.' });
    return res.json({ incident: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/suppliers/:supplierId/reviews', requireRole('admin'), async (req, res, next) => {
  try {
    if (!String(req.body.rationale || '').trim()) return res.status(400).json({ message:'La justification est obligatoire.' });
    const { rows } = await req.db.query(`INSERT INTO supplier_reviews
      (organisation_id,supplier_id,review_date,review_type,decision,rationale,conditions,next_review_at,reviewed_by,idempotency_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (organisation_id,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING *`, [req.organisationId,req.params.supplierId,req.body.reviewDate || new Date(),req.body.reviewType || 'periodic',req.body.decision,req.body.rationale.trim(),req.body.conditions || [],req.body.nextReviewAt || null,req.user?.id || null,req.body.idempotencyKey]);
    await req.db.query('UPDATE suppliers SET last_review_at=$3,next_review_at=$4,status=CASE WHEN $5 IN (\'suspend\',\'terminate\') THEN \'blocked\' ELSE status END WHERE organisation_id=$1 AND id=$2', [req.organisationId,req.params.supplierId,req.body.reviewDate || new Date(),req.body.nextReviewAt || null,req.body.decision]);
    return res.status(201).json({ review: rows[0] });
  } catch (error) { return next(error); }
});

router.get('/dashboard', async (req, res, next) => {
  try {
    const [scores,incidents,critical] = await Promise.all([
      req.db.query('SELECT COUNT(*)::integer suppliers,AVG(last_performance_score)::numeric average_score,COUNT(*) FILTER (WHERE last_performance_score<60)::integer at_risk FROM suppliers WHERE organisation_id=$1 AND status=\'active\'', [req.organisationId]),
      req.db.query("SELECT COUNT(*)::integer open_incidents,COUNT(*) FILTER (WHERE severity='critical')::integer critical_incidents FROM supplier_incidents WHERE organisation_id=$1 AND status NOT IN ('resolved','closed')", [req.organisationId]),
      req.db.query('SELECT COUNT(*)::integer critical_suppliers FROM suppliers WHERE organisation_id=$1 AND is_critical', [req.organisationId]),
    ]);
    return res.json({ ...scores.rows[0], ...incidents.rows[0], ...critical.rows[0] });
  } catch (error) { return next(error); }
});

module.exports = router;
