function number(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function round(value, digits = 3) { return Number(number(value).toFixed(digits)); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function orderToMultiple(quantity, multiple, minimum) {
  const base = Math.max(number(quantity), number(minimum));
  const step = Math.max(number(multiple), 0.001);
  return round(Math.ceil(base / step) * step, 3);
}

async function createValuationSnapshot(db, organisationId, actorUserId, { snapshotDate } = {}) {
  const date = snapshotDate || new Date().toISOString().slice(0, 10);
  await db.query('BEGIN');
  try {
    const maxTx = await db.query(`SELECT MAX(id)::bigint max_id FROM inventory_transactions WHERE organisation_id=$1 AND occurred_at<($2::date+INTERVAL '1 day')`, [organisationId,date]);
    const { rows } = await db.query(
      `INSERT INTO inventory_valuation_snapshots
        (organisation_id,snapshot_date,item_id,location_id,quantity,average_cost,inventory_value,source_max_transaction_id,generated_by)
       SELECT b.organisation_id,$2,b.item_id,b.location_id,b.quantity,b.average_cost,b.inventory_value,$3,$4
       FROM inventory_balances b WHERE b.organisation_id=$1
       ON CONFLICT (organisation_id,snapshot_date,item_id,location_id)
       DO UPDATE SET quantity=EXCLUDED.quantity,average_cost=EXCLUDED.average_cost,inventory_value=EXCLUDED.inventory_value,
                     source_max_transaction_id=EXCLUDED.source_max_transaction_id,generated_by=EXCLUDED.generated_by,generated_at=NOW()
       RETURNING *`,
      [organisationId,date,maxTx.rows[0]?.max_id || null,actorUserId || null],
    );
    await db.query('COMMIT');
    return { snapshotDate: date, rows };
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}

async function valuationAt(db, organisationId, date) {
  const { rows } = await db.query(
    `SELECT s.*,i.sku,i.name item_name,l.code location_code,l.name location_name
     FROM inventory_valuation_snapshots s
     JOIN inventory_items i ON i.organisation_id=s.organisation_id AND i.id=s.item_id
     JOIN inventory_locations l ON l.organisation_id=s.organisation_id AND l.id=s.location_id
     WHERE s.organisation_id=$1 AND s.snapshot_date=$2
     ORDER BY i.name,l.name`, [organisationId,date]);
  return rows;
}

async function movementAnalytics(db, organisationId, { days = 90, itemId, locationId } = {}) {
  const horizon = clamp(Math.round(number(days) || 90), 1, 730);
  const { rows } = await db.query(
    `WITH usage AS (
       SELECT item_id,source_location_id location_id,
              SUM(CASE WHEN transaction_type='issue' THEN quantity ELSE 0 END)::numeric issued_quantity,
              COUNT(*) FILTER (WHERE transaction_type='issue')::integer issue_count,
              MIN(occurred_at) FILTER (WHERE transaction_type='issue') first_issue,
              MAX(occurred_at) FILTER (WHERE transaction_type='issue') last_issue
       FROM inventory_transactions
       WHERE organisation_id=$1 AND occurred_at>=NOW()-($2::integer||' days')::interval
         AND ($3::bigint IS NULL OR item_id=$3)
         AND ($4::bigint IS NULL OR source_location_id=$4)
       GROUP BY item_id,source_location_id
     )
     SELECT i.id item_id,i.sku,i.name,l.id location_id,l.code location_code,
            COALESCE(b.quantity,0)::numeric quantity_on_hand,
            COALESCE(u.issued_quantity,0)::numeric issued_quantity,
            COALESCE(u.issue_count,0)::integer issue_count,
            ROUND((COALESCE(u.issued_quantity,0)/$2::numeric),6) average_daily_usage,
            CASE WHEN COALESCE(u.issued_quantity,0)>0
              THEN ROUND((COALESCE(b.quantity,0)/(u.issued_quantity/$2::numeric)),2)
              ELSE NULL END days_of_stock,
            u.first_issue,u.last_issue
     FROM inventory_items i
     CROSS JOIN inventory_locations l
     LEFT JOIN inventory_balances b ON b.organisation_id=i.organisation_id AND b.item_id=i.id AND b.location_id=l.id
     LEFT JOIN usage u ON u.item_id=i.id AND u.location_id=l.id
     WHERE i.organisation_id=$1 AND l.organisation_id=$1 AND i.is_active=TRUE AND l.is_active=TRUE
       AND ($3::bigint IS NULL OR i.id=$3) AND ($4::bigint IS NULL OR l.id=$4)
     ORDER BY i.name,l.name`, [organisationId,horizon,itemId || null,locationId || null]);
  return { horizonDays: horizon, rows };
}

async function agingReport(db, organisationId) {
  const { rows } = await db.query(
    `SELECT i.id item_id,i.sku,i.name,l.id lot_id,l.lot_number,l.received_at,l.expires_at,l.status,
            COALESCE(SUM(b.quantity),0)::numeric quantity,
            l.unit_cost,
            ROUND((COALESCE(SUM(b.quantity),0)*l.unit_cost)::numeric,4) value,
            (CURRENT_DATE-l.received_at::date)::integer age_days,
            CASE WHEN l.expires_at IS NULL THEN 'no_expiry'
                 WHEN l.expires_at<CURRENT_DATE THEN 'expired'
                 WHEN l.expires_at<=CURRENT_DATE+30 THEN 'expires_30_days'
                 WHEN CURRENT_DATE-l.received_at::date>365 THEN 'older_than_year'
                 WHEN CURRENT_DATE-l.received_at::date>180 THEN '181_365_days'
                 WHEN CURRENT_DATE-l.received_at::date>90 THEN '91_180_days'
                 ELSE '0_90_days' END aging_bucket
     FROM inventory_lots l
     JOIN inventory_items i ON i.organisation_id=l.organisation_id AND i.id=l.item_id
     LEFT JOIN inventory_lot_balances b ON b.organisation_id=l.organisation_id AND b.lot_id=l.id
     WHERE l.organisation_id=$1 GROUP BY i.id,i.sku,i.name,l.id ORDER BY age_days DESC,l.id`, [organisationId]);
  return rows;
}

async function calculateSuggestions(db, organisationId, actorUserId, { days = 90 } = {}) {
  const analytics = await movementAnalytics(db, organisationId, { days });
  const policies = await db.query(`SELECT * FROM inventory_replenishment_policies WHERE organisation_id=$1 AND is_active=TRUE`, [organisationId]);
  const policyMap = new Map(policies.rows.map((row) => [`${row.item_id}:${row.location_id || '*'}`, row]));
  const suggestions = [];
  for (const row of analytics.rows) {
    const policy = policyMap.get(`${row.item_id}:${row.location_id}`) || policyMap.get(`${row.item_id}:*`);
    if (!policy) continue;
    const daily = number(row.average_daily_usage);
    const lead = number(policy.lead_time_days);
    const review = number(policy.review_period_days);
    const safety = number(policy.safety_stock);
    const reorderPoint = round(daily * lead + safety, 3);
    const available = number(row.quantity_on_hand);
    const inboundResult = await db.query(
      `SELECT COALESCE(SUM(l.ordered_quantity-l.received_quantity),0)::numeric inbound
       FROM procurement_purchase_order_lines l JOIN procurement_purchase_orders p ON p.organisation_id=l.organisation_id AND p.id=l.purchase_order_id
       WHERE l.organisation_id=$1 AND l.inventory_item_id=$2 AND p.status IN ('approved','sent','partially_received')`, [organisationId,row.item_id]);
    const inbound = number(inboundResult.rows[0]?.inbound);
    const projected = round(available + inbound - daily * lead, 3);
    const raw = Math.max(0, daily * (lead + review) + safety - available - inbound);
    const suggested = raw > 0 ? orderToMultiple(raw, policy.order_multiple, policy.minimum_order_quantity) : 0;
    const stockoutDate = daily > 0 && available / daily < 365 ? new Date(Date.now() + Math.ceil(available / daily) * 86400000).toISOString().slice(0,10) : null;
    const confidence = round(clamp(number(row.issue_count) / 20, 0.1, 1), 4);
    const explanation = { formula: 'usage*(lead+review)+safety-available-inbound', averageDailyUsage: daily, leadTimeDays: lead, reviewPeriodDays: review, safetyStock: safety, available, inbound };
    const insert = await db.query(
      `INSERT INTO inventory_replenishment_suggestions
        (organisation_id,item_id,location_id,horizon_days,average_daily_usage,available_quantity,inbound_quantity,projected_quantity,reorder_point,suggested_quantity,stockout_date,confidence,explanation,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14) RETURNING *`,
      [organisationId,row.item_id,row.location_id,analytics.horizonDays,daily,available,inbound,projected,reorderPoint,suggested,stockoutDate,confidence,JSON.stringify(explanation),actorUserId || null]);
    suggestions.push(insert.rows[0]);
  }
  return suggestions;
}

async function exportValuationCsv(db, organisationId, date) {
  const rows = await valuationAt(db, organisationId, date);
  const escape = (value) => `"${String(value ?? '').replace(/"/g,'""')}"`;
  const header = ['date','sku','article','emplacement','quantité','coût moyen','valeur'];
  return [header.map(escape).join(','), ...rows.map((r) => [r.snapshot_date,r.sku,r.item_name,r.location_code,r.quantity,r.average_cost,r.inventory_value].map(escape).join(','))].join('\n');
}

module.exports = { number, round, orderToMultiple, createValuationSnapshot, valuationAt, movementAnalytics, agingReport, calculateSuggestions, exportValuationCsv };
