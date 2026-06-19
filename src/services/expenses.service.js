const db = require("../../db");

async function listExpenses({ organisationId, projetId }) {
  let query = `
    SELECT *
    FROM expenses
    WHERE organisation_id = $1 AND deleted_at IS NULL
  `;
  const params = [organisationId];

  if (projetId) {
    params.push(projetId);
    query += ` AND projet_id = $2`;
  }

  query += ` ORDER BY expense_date DESC, id DESC`;

  const { rows } = await db.query(query, params);
  return rows;
}

async function getExpenseById({ expenseId, organisationId }) {
  const { rows } = await db.query(
    `SELECT * FROM expenses WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
    [expenseId, organisationId]
  );
  return rows[0] || null;
}

async function createExpense({ data, organisationId }) {
  const {
    projet_id,
    amount,
    tax_amount,
    total_amount,
    category,
    expense_date,
    description,
    distance,
    rate_per_unit,
    is_billable,
    is_billed
  } = data;

  const query = `
    INSERT INTO expenses (
      organisation_id, projet_id, amount, tax_amount, total_amount,
      category, expense_date, description, distance, rate_per_unit,
      is_billable, is_billed
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `;
  const params = [
    organisationId,
    projet_id,
    amount || 0,
    tax_amount || 0,
    total_amount || 0,
    category || 'general',
    expense_date || new Date().toISOString().split('T')[0],
    description || null,
    distance || null,
    rate_per_unit || null,
    is_billable !== undefined ? is_billable : true,
    is_billed !== undefined ? is_billed : false
  ];

  const { rows } = await db.query(query, params);
  return rows[0];
}

async function updateExpense({ expenseId, data, organisationId }) {
  const expense = await getExpenseById({ expenseId, organisationId });
  if (!expense) return null;

  const fields = [];
  const params = [];
  let paramIdx = 1;

  for (const [key, value] of Object.entries(data)) {
    const validFields = [
      'projet_id', 'amount', 'tax_amount', 'total_amount', 'category',
      'expense_date', 'description', 'distance', 'rate_per_unit',
      'is_billable', 'is_billed'
    ];
    if (validFields.includes(key)) {
      fields.push(`${key} = $${paramIdx}`);
      params.push(value);
      paramIdx++;
    }
  }

  if (fields.length === 0) return expense;

  params.push(expenseId, organisationId);
  const query = `
    UPDATE expenses
    SET ${fields.join(', ')}
    WHERE id = $${paramIdx - 2} AND organisation_id = $${paramIdx - 1}
    RETURNING *
  `;

  const { rows } = await db.query(query, params);
  return rows[0];
}

async function deleteExpense({ expenseId, organisationId }) {
  const { rows } = await db.query(
    `UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL RETURNING id`,
    [expenseId, organisationId]
  );
  return rows[0] || null;
}

module.exports = {
  listExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense
};
