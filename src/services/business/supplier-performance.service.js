const db = require('../../../db');

const clamp = (value) => Math.max(0, Math.min(100, Number(value || 0)));

function calculateSupplierScore(metrics = {}) {
  const onTime = clamp(metrics.onTimeDeliveryRate);
  const quality = 100 - clamp(metrics.rejectionRate);
  const invoices = 100 - clamp(metrics.invoiceExceptionRate);
  const compliance = clamp(metrics.complianceScore);
  const incidents = clamp(metrics.incidentScore);
  const overallScore = Number((onTime * 0.3 + quality * 0.2 + invoices * 0.2 + compliance * 0.2 + incidents * 0.1).toFixed(2));
  return {
    overallScore,
    explanation: {
      weights: { onTimeDelivery: 0.3, quality: 0.2, invoiceAccuracy: 0.2, compliance: 0.2, incidents: 0.1 },
      inputs: { onTime, quality, invoices, compliance, incidents },
    },
  };
}

async function createSnapshot({ organisationId, supplierId, periodStart, periodEnd }) {
  const supplier = (await db.pool.query('SELECT * FROM suppliers WHERE organisation_id=$1 AND id=$2', [organisationId,supplierId])).rows[0];
  if (!supplier) return null;
  const delivery = (await db.pool.query(`SELECT COUNT(*) FILTER (WHERE received_at::date <= expected_at::date)::numeric on_time,COUNT(*)::numeric total
    FROM inventory_receipts r JOIN inventory_purchase_orders p ON p.organisation_id=r.organisation_id AND p.id=r.purchase_order_id
    WHERE r.organisation_id=$1 AND p.supplier_id=$2 AND r.received_at::date BETWEEN $3 AND $4`, [organisationId,supplierId,periodStart,periodEnd])).rows[0];
  const invoice = (await db.pool.query(`SELECT COUNT(*) FILTER (WHERE matching_status='exception')::numeric exceptions,COUNT(*)::numeric total,COALESCE(SUM(total),0) spend
    FROM supplier_bills WHERE organisation_id=$1 AND supplier_id=$2 AND bill_date BETWEEN $3 AND $4`, [organisationId,supplierId,periodStart,periodEnd])).rows[0];
  const documents = (await db.pool.query(`SELECT COUNT(*) FILTER (WHERE status='valid' AND (expires_at IS NULL OR expires_at>CURRENT_DATE))::numeric valid,COUNT(*)::numeric total
    FROM supplier_compliance_documents WHERE organisation_id=$1 AND supplier_id=$2`, [organisationId,supplierId])).rows[0];
  const incidents = (await db.pool.query(`SELECT COUNT(*) FILTER (WHERE severity='critical')::numeric critical,COUNT(*)::numeric total
    FROM supplier_incidents WHERE organisation_id=$1 AND supplier_id=$2 AND occurred_at::date BETWEEN $3 AND $4`, [organisationId,supplierId,periodStart,periodEnd])).rows[0];

  const metrics = {
    onTimeDeliveryRate: Number(delivery.total) ? Number(delivery.on_time) / Number(delivery.total) * 100 : 100,
    rejectionRate: 0,
    invoiceExceptionRate: Number(invoice.total) ? Number(invoice.exceptions) / Number(invoice.total) * 100 : 0,
    complianceScore: Number(documents.total) ? Number(documents.valid) / Number(documents.total) * 100 : 100,
    incidentScore: Math.max(0, 100 - Number(incidents.total || 0) * 10 - Number(incidents.critical || 0) * 25),
  };
  const score = calculateSupplierScore(metrics);
  const snapshot = (await db.pool.query(`INSERT INTO supplier_performance_snapshots
    (organisation_id,supplier_id,period_start,period_end,on_time_delivery_rate,rejection_rate,invoice_exception_rate,compliance_score,incident_score,spend_total,overall_score,score_explanation)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (organisation_id,supplier_id,period_start,period_end) DO UPDATE SET
      on_time_delivery_rate=EXCLUDED.on_time_delivery_rate,invoice_exception_rate=EXCLUDED.invoice_exception_rate,
      compliance_score=EXCLUDED.compliance_score,incident_score=EXCLUDED.incident_score,spend_total=EXCLUDED.spend_total,
      overall_score=EXCLUDED.overall_score,score_explanation=EXCLUDED.score_explanation,generated_at=NOW()
    RETURNING *`, [organisationId,supplierId,periodStart,periodEnd,metrics.onTimeDeliveryRate,metrics.rejectionRate,metrics.invoiceExceptionRate,metrics.complianceScore,metrics.incidentScore,invoice.spend,score.overallScore,score.explanation])).rows[0];
  await db.pool.query('UPDATE suppliers SET last_performance_score=$3 WHERE organisation_id=$1 AND id=$2', [organisationId,supplierId,score.overallScore]);
  return snapshot;
}

module.exports = { calculateSupplierScore, createSnapshot };
