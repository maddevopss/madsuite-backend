const db = require("../../db");
const { getTimezone } = require("../utils/organisationScope");

function addOrganisationScope(conditions, params, alias, organisationId) {
  if (!organisationId) {
    const err = new Error("OrganisationId requis pour le dashboard facturation.");
    err.statusCode = 403;
    throw err;
  }

  params.push(organisationId);
  conditions.push(`${alias}.organisation_id = $${params.length}`);
}

function makeWhere(conditions) {
  return conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
}

function buildQueryScope({ baseConditions, extraConditions = [], organisationId, userId, isAdmin, alias, userColumn }) {
  const params = [];
  const conditions = [...baseConditions, ...extraConditions];

  if (!isAdmin) {
    params.push(userId);
    conditions.push(`${alias}.${userColumn} = $${params.length}`);
  }

  addOrganisationScope(conditions, params, alias, organisationId);

  return { conditions, params };
}

function mapBillableGroupRows(rows, idKey, nameKey) {
  return rows.map((row) => ({
    [idKey]: row[idKey],
    [nameKey]: row[nameKey],
    client_nom: row.client_nom,
    amount_to_bill: Number(row.amount_to_bill || 0),
    hours_to_bill: Number(row.hours_to_bill || 0),
  }));
}

async function getBillingDashboard({ organisationId, userId, role }) {
  const timezone = await getTimezone(organisationId);
  const isAdmin = role === "admin";
  const localToday = `(NOW() AT TIME ZONE '${timezone}')::date`;
  const monthStart = `(date_trunc('month', NOW() AT TIME ZONE '${timezone}') AT TIME ZONE '${timezone}')`;
  const nextMonthStart = `(${monthStart} + INTERVAL '1 month')`;

  const timeEntriesConditions = [
    "te.end_time IS NOT NULL",
    "te.deleted_at IS NULL",
    "c.deleted_at IS NULL",
    "p.deleted_at IS NULL",
  ];
  const invoiceConditions = ["i.deleted_at IS NULL", "c.deleted_at IS NULL"];

  const buildTimeEntryQuery = (extraConditions = []) =>
    buildQueryScope({
      baseConditions: timeEntriesConditions,
      extraConditions,
      organisationId,
      userId,
      isAdmin,
      alias: "te",
      userColumn: "utilisateur_id",
    });

  const buildInvoiceQuery = (extraConditions = []) =>
    buildQueryScope({
      baseConditions: invoiceConditions,
      extraConditions,
      organisationId,
      userId,
      isAdmin,
      alias: "i",
      userColumn: "billed_by",
    });

  const unbilled = buildTimeEntryQuery(["te.is_billed = FALSE", "te.invoice_id IS NULL"]);
  const billed = buildTimeEntryQuery(["te.is_billed = TRUE"]);
  const topClients = buildTimeEntryQuery(["te.is_billed = FALSE", "te.invoice_id IS NULL"]);
  const topProjects = buildTimeEntryQuery(["te.is_billed = FALSE", "te.invoice_id IS NULL"]);
  const recentInvoices = buildInvoiceQuery([]);
  const overdueInvoices = buildInvoiceQuery([
    "i.status = 'sent'",
    "i.due_date IS NOT NULL",
    `i.due_date < ${localToday}`,
  ]);
  const dueSoonInvoices = buildInvoiceQuery([
    "i.status = 'sent'",
    "i.due_date IS NOT NULL",
    `i.due_date >= ${localToday}`,
    `i.due_date <= (${localToday} + INTERVAL '7 days')`,
  ]);
  const monthInvoices = buildInvoiceQuery([]);
  monthInvoices.conditions.push(`i.created_at >= ${monthStart}`);
  monthInvoices.conditions.push(`i.created_at < ${nextMonthStart}`);
  const outstandingInvoices = buildInvoiceQuery(["i.status = 'sent'"]);
  const financialTopClients = buildInvoiceQuery(["i.status IN ('sent', 'paid')"]);
  const monthlyRevenue = buildInvoiceQuery(["i.status = 'paid'"]);
  monthlyRevenue.conditions.push(`i.issue_date >= (${monthStart} - INTERVAL '5 months')`);
  monthlyRevenue.conditions.push(`i.issue_date < ${nextMonthStart}`);

  const amountExpression = `
    (EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600)
    * COALESCE(te.hourly_rate_used, p.taux_horaire, c.hourly_rate_defaut, 0)
  `;
  const hoursExpression = "EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 3600";

  const [
    unbilledResult,
    billedResult,
    monthInvoicesResult,
    topClientsResult,
    topProjectsResult,
    recentInvoicesResult,
    overdueInvoicesResult,
    overdueSummaryResult,
    dueSoonInvoicesResult,
    invoiceStatusResult,
    outstandingResult,
    financialTopClientsResult,
    monthlyRevenueResult,
  ] = await Promise.all([
    db.query(
      `
      SELECT
        COALESCE(SUM(${hoursExpression}), 0) AS unbilled_hours,
        COALESCE(SUM(${amountExpression}), 0) AS total_to_invoice
      FROM time_entries te
      JOIN projets p ON p.id = te.projet_id
      JOIN clients c ON c.id = p.client_id
      ${makeWhere(unbilled.conditions)}
      `,
      unbilled.params,
    ),
    db.query(
      `
      SELECT COALESCE(SUM(${hoursExpression}), 0) AS billed_hours
      FROM time_entries te
      JOIN projets p ON p.id = te.projet_id
      JOIN clients c ON c.id = p.client_id
      ${makeWhere(billed.conditions)}
      `,
      billed.params,
    ),
    db.query(
      `
      SELECT
        COALESCE(SUM(CASE WHEN i.status IN ('draft', 'sent', 'paid') THEN i.total ELSE 0 END), 0)
          AS total_invoiced_this_month,
        COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END), 0)
          AS total_paid_this_month
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(monthInvoices.conditions)}
      `,
      monthInvoices.params,
    ),
    db.query(
      `
      SELECT
        c.id AS client_id,
        c.nom AS client_nom,
        COALESCE(SUM(${amountExpression}), 0) AS amount_to_bill,
        COALESCE(SUM(${hoursExpression}), 0) AS hours_to_bill
      FROM time_entries te
      JOIN projets p ON p.id = te.projet_id
      JOIN clients c ON c.id = p.client_id
      ${makeWhere(topClients.conditions)}
      GROUP BY c.id, c.nom
      ORDER BY amount_to_bill DESC
      LIMIT 5
      `,
      topClients.params,
    ),
    db.query(
      `
      SELECT
        p.id AS projet_id,
        p.nom AS projet_nom,
        c.nom AS client_nom,
        COALESCE(SUM(${amountExpression}), 0) AS amount_to_bill,
        COALESCE(SUM(${hoursExpression}), 0) AS hours_to_bill
      FROM time_entries te
      JOIN projets p ON p.id = te.projet_id
      JOIN clients c ON c.id = p.client_id
      ${makeWhere(topProjects.conditions)}
      GROUP BY p.id, p.nom, c.nom
      ORDER BY amount_to_bill DESC
      LIMIT 5
      `,
      topProjects.params,
    ),
    db.query(
      `
      SELECT
        i.id,
        i.invoice_number,
        i.status,
        i.issue_date,
        i.due_date,
        i.total,
        c.nom AS client_nom
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(recentInvoices.conditions)}
      ORDER BY i.created_at DESC
      LIMIT 10
      `,
      recentInvoices.params,
    ),
    db.query(
      `
      SELECT
        i.id,
        i.invoice_number,
        i.status,
        i.issue_date,
        i.due_date,
        i.total,
        c.nom AS client_nom
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(overdueInvoices.conditions)}
      ORDER BY i.due_date ASC, i.created_at DESC
      LIMIT 10
      `,
      overdueInvoices.params,
    ),
    db.query(
      `
      SELECT
        COUNT(*) AS overdue_count,
        COALESCE(SUM(i.total), 0) AS overdue_total
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(overdueInvoices.conditions)}
      `,
      overdueInvoices.params,
    ),
    db.query(
      `
      SELECT
        i.id,
        i.invoice_number,
        i.status,
        i.issue_date,
        i.due_date,
        i.total,
        c.nom AS client_nom
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(dueSoonInvoices.conditions)}
      ORDER BY i.due_date ASC, i.created_at DESC
      LIMIT 10
      `,
      dueSoonInvoices.params,
    ),
    db.query(
      `
      SELECT
        i.status,
        COUNT(*) AS count,
        COALESCE(SUM(i.total), 0) AS total
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(recentInvoices.conditions)}
      GROUP BY i.status
      `,
      recentInvoices.params,
    ),
    db.query(
      `
      SELECT COALESCE(SUM(i.total), 0) AS outstanding_total
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(outstandingInvoices.conditions)}
      `,
      outstandingInvoices.params,
    ),
    db.query(
      `
      SELECT
        c.id AS client_id,
        c.nom AS client_nom,
        COALESCE(SUM(i.total), 0) AS total_invoiced,
        COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.total ELSE 0 END), 0) AS total_paid
      FROM invoices i
      JOIN clients c ON c.id = i.client_id
      ${makeWhere(financialTopClients.conditions)}
      GROUP BY c.id, c.nom
      ORDER BY total_invoiced DESC, c.id ASC
      LIMIT 5
      `,
      financialTopClients.params,
    ),
    db.query(
      `
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', NOW() AT TIME ZONE '${timezone}') - INTERVAL '5 months',
          date_trunc('month', NOW() AT TIME ZONE '${timezone}'),
          INTERVAL '1 month'
        )::date AS month
      ), paid AS (
        SELECT
          date_trunc('month', i.issue_date)::date AS month,
          COALESCE(SUM(i.total), 0) AS total_paid
        FROM invoices i
        JOIN clients c ON c.id = i.client_id
        ${makeWhere(monthlyRevenue.conditions)}
        GROUP BY date_trunc('month', i.issue_date)::date
      )
      SELECT
        TO_CHAR(months.month, 'YYYY-MM') AS month,
        COALESCE(paid.total_paid, 0) AS total_paid
      FROM months
      LEFT JOIN paid ON paid.month = months.month
      ORDER BY months.month ASC
      `,
      monthlyRevenue.params,
    ),
  ]);

  const invoiceStatus = Object.fromEntries(
    invoiceStatusResult.rows.map((row) => [
      row.status,
      {
        count: Number(row.count || 0),
        total: Number(row.total || 0),
      },
    ]),
  );

  return {
    total_to_invoice: Number(unbilledResult.rows[0]?.total_to_invoice || 0),
    total_invoiced_this_month: Number(monthInvoicesResult.rows[0]?.total_invoiced_this_month || 0),
    total_paid_this_month: Number(monthInvoicesResult.rows[0]?.total_paid_this_month || 0),
    outstanding_total: Number(outstandingResult.rows[0]?.outstanding_total || 0),
    unbilled_hours: Number(unbilledResult.rows[0]?.unbilled_hours || 0),
    billed_hours: Number(billedResult.rows[0]?.billed_hours || 0),
    overdue_count: Number(overdueSummaryResult.rows[0]?.overdue_count || 0),
    overdue_total: Number(overdueSummaryResult.rows[0]?.overdue_total || 0),
    due_soon_count: dueSoonInvoicesResult.rows.length,
    due_soon_total: dueSoonInvoicesResult.rows.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
    invoice_status: invoiceStatus,
    top_clients: financialTopClientsResult.rows.map((row) => ({
      client_id: row.client_id,
      client_nom: row.client_nom,
      total_invoiced: Number(row.total_invoiced || 0),
      total_paid: Number(row.total_paid || 0),
    })),
    monthly_revenue: monthlyRevenueResult.rows.map((row) => ({
      month: row.month,
      total_paid: Number(row.total_paid || 0),
    })),
    currency: "CAD",
    calculated_at: new Date().toISOString(),
    top_clients_to_bill: mapBillableGroupRows(topClientsResult.rows, "client_id", "client_nom"),
    top_projects_to_bill: mapBillableGroupRows(topProjectsResult.rows, "projet_id", "projet_nom"),
    recent_invoices: recentInvoicesResult.rows,
    overdue_invoices: overdueInvoicesResult.rows,
    due_soon_invoices: dueSoonInvoicesResult.rows,
  };
}

module.exports = {
  getBillingDashboard,
};
