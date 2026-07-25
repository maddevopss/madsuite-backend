const EVENT_TO_COLUMN = {
  "invoice.finalized": "invoiced",
  "payment.received": "customer_payments",
  "supplier.bill.approved": "supplier_bills",
  "supplier.payment.posted": "supplier_payments",
  "expense.posted": "expenses",
};

function eventAmount(event) {
  const value = Number(event.payload?.amount ?? event.payload?.total ?? 0);
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
}

async function rebuildFinancialDailyProjection(client, organisationId) {
  const { rows: events } = await client.query(
    `SELECT id, event_type, payload, occurred_at
     FROM business_events
     WHERE organisation_id = $1
       AND event_type = ANY($2::varchar[])
     ORDER BY id`,
    [organisationId, Object.keys(EVENT_TO_COLUMN)],
  );

  const byDay = new Map();
  for (const event of events) {
    const date = new Date(event.occurred_at).toISOString().slice(0, 10);
    const current = byDay.get(date) || {
      invoiced: 0,
      customer_payments: 0,
      supplier_bills: 0,
      supplier_payments: 0,
      expenses: 0,
      source_event_count: 0,
    };
    const column = EVENT_TO_COLUMN[event.event_type];
    current[column] = Number((current[column] + eventAmount(event)).toFixed(2));
    current.source_event_count += 1;
    byDay.set(date, current);
  }

  await client.query("DELETE FROM financial_daily_projections WHERE organisation_id = $1", [organisationId]);
  for (const [projectionDate, values] of byDay) {
    const netCashFlow = Number((values.customer_payments - values.supplier_payments - values.expenses).toFixed(2));
    await client.query(
      `INSERT INTO financial_daily_projections
        (organisation_id, projection_date, invoiced, customer_payments, supplier_bills,
         supplier_payments, expenses, net_cash_flow, source_event_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        organisationId,
        projectionDate,
        values.invoiced,
        values.customer_payments,
        values.supplier_bills,
        values.supplier_payments,
        values.expenses,
        netCashFlow,
        values.source_event_count,
      ],
    );
  }

  const lastEvent = events.at(-1);
  await client.query(
    `INSERT INTO business_projection_checkpoints
      (organisation_id, projection_name, last_event_id, last_recorded_at)
     VALUES ($1,'financial_daily',$2,$3)
     ON CONFLICT (organisation_id, projection_name)
     DO UPDATE SET last_event_id = EXCLUDED.last_event_id,
                   last_recorded_at = EXCLUDED.last_recorded_at,
                   updated_at = NOW()`,
    [organisationId, lastEvent?.id || null, lastEvent?.occurred_at || null],
  );

  return { days: byDay.size, events: events.length };
}

async function listFinancialDailyProjection(client, organisationId, { startDate, endDate } = {}) {
  const values = [organisationId];
  const conditions = ["organisation_id = $1"];
  if (startDate) {
    values.push(startDate);
    conditions.push(`projection_date >= $${values.length}`);
  }
  if (endDate) {
    values.push(endDate);
    conditions.push(`projection_date <= $${values.length}`);
  }
  const { rows } = await client.query(
    `SELECT * FROM financial_daily_projections
     WHERE ${conditions.join(" AND ")}
     ORDER BY projection_date`,
    values,
  );
  return rows;
}

module.exports = { EVENT_TO_COLUMN, eventAmount, rebuildFinancialDailyProjection, listFinancialDailyProjection };
