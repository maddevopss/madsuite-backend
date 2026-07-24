const db = require("../../db");

const ALLOWED_SORTS = new Map([
  ["date_desc", "expense_date DESC, id DESC"],
  ["date_asc", "expense_date ASC, id ASC"],
  ["total_desc", "total_amount DESC, id DESC"],
  ["total_asc", "total_amount ASC, id ASC"],
]);

function normalizeMoney(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${fieldName} doit être un montant positif ou nul.`);
    error.statusCode = 400;
    throw error;
  }
  return Math.round(number * 100) / 100;
}

function normalizeExpenseData(data, { partial = false } = {}) {
  const normalized = {};

  if (!partial || Object.prototype.hasOwnProperty.call(data, "amount")) {
    normalized.amount = normalizeMoney(data.amount, "amount");
  }
  if (!partial || Object.prototype.hasOwnProperty.call(data, "tax_amount")) {
    normalized.tax_amount = normalizeMoney(data.tax_amount, "tax_amount");
  }

  if (!partial || Object.prototype.hasOwnProperty.call(data, "total_amount")) {
    const expectedTotal = Math.round(((normalized.amount ?? Number(data.amount || 0)) + (normalized.tax_amount ?? Number(data.tax_amount || 0))) * 100) / 100;
    const suppliedTotal = data.total_amount == null ? expectedTotal : normalizeMoney(data.total_amount, "total_amount");
    if (Math.abs(suppliedTotal - expectedTotal) > 0.01) {
      const error = new Error("total_amount doit correspondre à amount + tax_amount.");
      error.statusCode = 400;
      throw error;
    }
    normalized.total_amount = expectedTotal;
  }

  const copyFields = [
    "projet_id",
    "category",
    "expense_date",
    "description",
    "supplier",
    "currency",
    "distance",
    "rate_per_unit",
    "is_billable",
    "is_billed",
  ];

  for (const field of copyFields) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      normalized[field] = data[field];
    }
  }

  if (!partial) {
    normalized.category = String(data.category || "general").trim().toLowerCase();
    normalized.expense_date = data.expense_date || new Date().toISOString().slice(0, 10);
    normalized.supplier = data.supplier ? String(data.supplier).trim() : null;
    normalized.description = data.description ? String(data.description).trim() : null;
    normalized.currency = String(data.currency || "CAD").trim().toUpperCase();
    normalized.projet_id = data.projet_id || null;
    normalized.distance = data.distance ?? null;
    normalized.rate_per_unit = data.rate_per_unit ?? null;
    normalized.is_billable = data.is_billable ?? false;
    normalized.is_billed = data.is_billed ?? false;
  } else {
    if (normalized.category != null) normalized.category = String(normalized.category).trim().toLowerCase();
    if (normalized.supplier != null) normalized.supplier = String(normalized.supplier).trim() || null;
    if (normalized.description != null) normalized.description = String(normalized.description).trim() || null;
    if (normalized.currency != null) normalized.currency = String(normalized.currency).trim().toUpperCase();
  }

  return normalized;
}

async function assertProjectBelongsToOrganisation(projetId, organisationId) {
  if (!projetId) return;
  const { rowCount } = await db.query(
    `SELECT 1 FROM projets WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
    [projetId, organisationId],
  );
  if (!rowCount) {
    const error = new Error("Projet introuvable pour cette organisation.");
    error.statusCode = 400;
    throw error;
  }
}

function buildExpenseFilters({ organisationId, projetId, startDate, endDate, category, supplier }) {
  const conditions = ["organisation_id = $1", "deleted_at IS NULL"];
  const params = [organisationId];

  const add = (condition, value) => {
    params.push(value);
    conditions.push(condition.replace("?", `$${params.length}`));
  };

  if (projetId) add("projet_id = ?", projetId);
  if (startDate) add("expense_date >= ?", startDate);
  if (endDate) add("expense_date <= ?", endDate);
  if (category) add("category = ?", String(category).trim().toLowerCase());
  if (supplier) add("supplier ILIKE ?", `%${String(supplier).trim()}%`);

  return { where: conditions.join(" AND "), params };
}

async function listExpenses({
  organisationId,
  projetId,
  startDate,
  endDate,
  category,
  supplier,
  limit = 25,
  offset = 0,
  sort = "date_desc",
}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const orderBy = ALLOWED_SORTS.get(sort) || ALLOWED_SORTS.get("date_desc");
  const { where, params } = buildExpenseFilters({ organisationId, projetId, startDate, endDate, category, supplier });

  const listParams = [...params, safeLimit, safeOffset];
  const [itemsResult, summaryResult] = await Promise.all([
    db.query(
      `SELECT *
       FROM expenses
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      listParams,
    ),
    db.query(
      `SELECT
         COUNT(*)::int AS filtered_count,
         COALESCE(SUM(total_amount), 0) AS filtered_total,
         COALESCE(SUM(tax_amount), 0) AS filtered_tax_total
       FROM expenses
       WHERE ${where}`,
      params,
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  return {
    items: itemsResult.rows,
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total: Number(summary.filtered_count || 0),
    },
    summary: {
      total_amount: Number(summary.filtered_total || 0),
      tax_amount: Number(summary.filtered_tax_total || 0),
      currency: "CAD",
    },
  };
}

async function getExpenseById({ expenseId, organisationId }) {
  const { rows } = await db.query(
    `SELECT * FROM expenses WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
    [expenseId, organisationId],
  );
  return rows[0] || null;
}

async function createExpense({ data, organisationId }) {
  const normalized = normalizeExpenseData(data);
  await assertProjectBelongsToOrganisation(normalized.projet_id, organisationId);

  const { rows } = await db.query(
    `INSERT INTO expenses (
       organisation_id, projet_id, amount, tax_amount, total_amount,
       category, expense_date, description, supplier, currency,
       distance, rate_per_unit, is_billable, is_billed
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      organisationId,
      normalized.projet_id,
      normalized.amount,
      normalized.tax_amount,
      normalized.total_amount,
      normalized.category,
      normalized.expense_date,
      normalized.description,
      normalized.supplier,
      normalized.currency,
      normalized.distance,
      normalized.rate_per_unit,
      normalized.is_billable,
      normalized.is_billed,
    ],
  );
  return rows[0];
}

async function updateExpense({ expenseId, data, organisationId }) {
  const existing = await getExpenseById({ expenseId, organisationId });
  if (!existing) return null;

  const mergedForMoney = {
    amount: Object.prototype.hasOwnProperty.call(data, "amount") ? data.amount : existing.amount,
    tax_amount: Object.prototype.hasOwnProperty.call(data, "tax_amount") ? data.tax_amount : existing.tax_amount,
    total_amount: Object.prototype.hasOwnProperty.call(data, "total_amount") ? data.total_amount : undefined,
    ...data,
  };
  const normalized = normalizeExpenseData(mergedForMoney, { partial: true });
  if (Object.prototype.hasOwnProperty.call(data, "projet_id")) {
    await assertProjectBelongsToOrganisation(normalized.projet_id, organisationId);
  }

  const validFields = new Set([
    "projet_id", "amount", "tax_amount", "total_amount", "category",
    "expense_date", "description", "supplier", "currency", "distance",
    "rate_per_unit", "is_billable", "is_billed",
  ]);
  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(normalized)) {
    if (!validFields.has(key)) continue;
    params.push(value);
    fields.push(`${key} = $${params.length}`);
  }

  if (!fields.length) return existing;

  params.push(expenseId, organisationId);
  const expenseIdIndex = params.length - 1;
  const organisationIdIndex = params.length;
  const { rows } = await db.query(
    `UPDATE expenses
     SET ${fields.join(", ")}
     WHERE id = $${expenseIdIndex}
       AND organisation_id = $${organisationIdIndex}
       AND deleted_at IS NULL
     RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteExpense({ expenseId, organisationId }) {
  const { rows } = await db.query(
    `UPDATE expenses
     SET deleted_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [expenseId, organisationId],
  );
  return rows[0] || null;
}

module.exports = {
  listExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  normalizeExpenseData,
};
