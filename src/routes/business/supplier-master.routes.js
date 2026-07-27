const router = require('express').Router();
const requireRole = require('../../middleware/requireRole');
const supplierMasterService = require('../../services/business/supplier-master.service');
const supplierMatchingRoutes = require('./supplier-matching.routes');

router.use('/matching', supplierMatchingRoutes);

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const status = req.query.status || null;
    const complianceStatus = req.query.complianceStatus || null;
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const { rows } = await req.db.query(
      `SELECT s.*,
              COUNT(*) OVER()::integer total_count,
              COALESCE((SELECT jsonb_agg(c ORDER BY c.is_primary DESC,c.name)
                        FROM supplier_contacts c
                        WHERE c.organisation_id=s.organisation_id AND c.supplier_id=s.id AND c.is_active=TRUE),'[]'::jsonb) contacts,
              COALESCE((SELECT jsonb_agg(a ORDER BY a.is_primary DESC,a.address_type)
                        FROM supplier_addresses a
                        WHERE a.organisation_id=s.organisation_id AND a.supplier_id=s.id AND a.is_active=TRUE),'[]'::jsonb) addresses,
              COALESCE((SELECT COUNT(*) FROM supplier_compliance_documents d
                        WHERE d.organisation_id=s.organisation_id AND d.supplier_id=s.id
                          AND d.expires_at IS NOT NULL AND d.expires_at <= CURRENT_DATE + INTERVAL '30 days'),0)::integer expiring_documents
       FROM suppliers s
       WHERE s.organisation_id=$1
         AND ($2='' OR s.supplier_number ILIKE '%'||$2||'%' OR s.legal_name ILIKE '%'||$2||'%' OR s.trade_name ILIKE '%'||$2||'%')
         AND ($3::text IS NULL OR s.status=$3)
         AND ($4::text IS NULL OR s.compliance_status=$4)
       ORDER BY s.preferred DESC,s.legal_name,s.id
       LIMIT $5 OFFSET $6`,
      [req.organisationId, search, status, complianceStatus, limit, offset],
    );
    return res.json({ suppliers: rows, total: rows[0]?.total_count || 0, limit, offset });
  } catch (error) { return next(error); }
});

router.get('/compliance-alerts', async (req, res, next) => {
  try {
    const horizonDays = Math.min(Math.max(Number(req.query.horizonDays || 30), 0), 365);
    const { rows } = await req.db.query(
      `SELECT d.*,s.supplier_number,s.legal_name,
              (d.expires_at-CURRENT_DATE)::integer days_until_expiry
       FROM supplier_compliance_documents d
       JOIN suppliers s ON s.organisation_id=d.organisation_id AND s.id=d.supplier_id
       WHERE d.organisation_id=$1 AND d.status IN ('pending','valid')
         AND d.expires_at IS NOT NULL AND d.expires_at <= CURRENT_DATE + $2::integer
       ORDER BY d.expires_at,s.legal_name`,
      [req.organisationId, horizonDays],
    );
    return res.json({ alerts: rows, horizonDays });
  } catch (error) { return next(error); }
});

router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await supplierMasterService.createSupplier({ organisationId: req.organisationId, actorUserId: req.user?.id, payload: req.body || {} });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) { return next(error); }
});

router.post('/:id/contacts', requireRole('admin'), async (req, res, next) => {
  try {
    if (!String(req.body?.name || '').trim()) return res.status(400).json({ message: 'Le nom du contact est obligatoire.' });
    const { rows } = await req.db.query(`INSERT INTO supplier_contacts
      (organisation_id,supplier_id,contact_type,name,title,email,phone,mobile,language,is_primary)
      SELECT $1,s.id,$3,$4,$5,$6,$7,$8,$9,$10 FROM suppliers s WHERE s.organisation_id=$1 AND s.id=$2 RETURNING *`,
      [req.organisationId,req.params.id,req.body.contactType || 'general',String(req.body.name).trim(),req.body.title || null,req.body.email || null,req.body.phone || null,req.body.mobile || null,req.body.language || 'fr-CA',Boolean(req.body.isPrimary)]);
    if (!rows[0]) return res.status(404).json({ message: 'Fournisseur introuvable.' });
    return res.status(201).json({ contact: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/:id/addresses', requireRole('admin'), async (req, res, next) => {
  try {
    if (!String(req.body?.line1 || '').trim() || !String(req.body?.city || '').trim()) return res.status(400).json({ message: 'L’adresse et la ville sont obligatoires.' });
    const { rows } = await req.db.query(`INSERT INTO supplier_addresses
      (organisation_id,supplier_id,address_type,line1,line2,city,region,postal_code,country_code,is_primary)
      SELECT $1,s.id,$3,$4,$5,$6,$7,$8,$9,$10 FROM suppliers s WHERE s.organisation_id=$1 AND s.id=$2 RETURNING *`,
      [req.organisationId,req.params.id,req.body.addressType || 'business',String(req.body.line1).trim(),req.body.line2 || null,String(req.body.city).trim(),req.body.region || null,req.body.postalCode || null,req.body.countryCode || 'CA',Boolean(req.body.isPrimary)]);
    if (!rows[0]) return res.status(404).json({ message: 'Fournisseur introuvable.' });
    return res.status(201).json({ address: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/:id/compliance-documents', requireRole('admin'), async (req, res, next) => {
  try {
    if (!String(req.body?.documentType || '').trim()) return res.status(400).json({ message: 'Le type de document est obligatoire.' });
    const { rows } = await req.db.query(`INSERT INTO supplier_compliance_documents
      (organisation_id,supplier_id,document_type,document_number,issued_at,expires_at,status,file_reference,notes,verified_by,verified_at)
      SELECT $1,s.id,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $7='valid' THEN NOW() ELSE NULL END FROM suppliers s WHERE s.organisation_id=$1 AND s.id=$2 RETURNING *`,
      [req.organisationId,req.params.id,String(req.body.documentType).trim(),req.body.documentNumber || null,req.body.issuedAt || null,req.body.expiresAt || null,req.body.status || 'pending',req.body.fileReference || {},req.body.notes || null,req.user?.id || null]);
    if (!rows[0]) return res.status(404).json({ message: 'Fournisseur introuvable.' });
    return res.status(201).json({ document: rows[0] });
  } catch (error) { return next(error); }
});

router.post('/:id/status', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await supplierMasterService.changeStatus({ organisationId: req.organisationId, supplierId: req.params.id, status: req.body.status, reason: req.body.reason, actorUserId: req.user?.id, idempotencyKey: req.body.idempotencyKey });
    return res.status(200).json(result);
  } catch (error) { return next(error); }
});

router.get('/:id/audit', async (req, res, next) => {
  try {
    const { rows } = await req.db.query('SELECT * FROM supplier_audit_events WHERE organisation_id=$1 AND supplier_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT 250', [req.organisationId,req.params.id]);
    return res.json({ events: rows });
  } catch (error) { return next(error); }
});

module.exports = router;
