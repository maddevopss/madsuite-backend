const db = require("../../../db");
const { organisationValue } = require("../../utils/organisationScope");
const { getEstimateById } = require("./estimate-query.service");
const analyticsService = require("../analytics.service");

/**
 * Crée une soumission (estimate) et ses items.
 */
async function createEstimate(data) {
  const { organisationId, clientId, issueDate, validUntil, notes, taxRate = 0, items } = data;

  let totalAmount = 0;
  const mappedItems = items.map(item => {
    const amount = item.quantity * item.unit_rate;
    totalAmount += amount;
    return { ...item, amount };
  });

  const taxAmount = (totalAmount * taxRate) / 100;
  const finalTotal = totalAmount + taxAmount;

  // Generate estimate number
  const resultCount = await db.query(
    "SELECT COUNT(*) FROM estimates WHERE organisation_id = $1",
    [organisationValue(organisationId)]
  );
  const count = parseInt(resultCount.rows[0].count, 10) + 1;
  const estimateNumber = `EST-${new Date().getFullYear()}-${count.toString().padStart(4, "0")}`;

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Insert estimate
    const estimateRes = await client.query(
      `INSERT INTO estimates (
        organisation_id, client_id, estimate_number, status, 
        issue_date, valid_until, subtotal, tax_total, total, notes
      ) VALUES ($1, $2, $3, 'draft', $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        organisationValue(organisationId),
        clientId,
        estimateNumber,
        issueDate || null,
        validUntil || null,
        totalAmount,
        taxAmount,
        finalTotal,
        notes || null
      ]
    );
    const estimate = estimateRes.rows[0];

    // Insert items
    const savedItems = [];
    for (const item of mappedItems) {
      const itemRes = await client.query(
        `INSERT INTO estimate_items (
          organisation_id, estimate_id, description, quantity, unit_rate, amount
        ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          organisationValue(organisationId),
          estimate.id,
          item.description,
          item.quantity,
          item.unit_rate,
          item.amount
        ]
      );
      savedItems.push(itemRes.rows[0]);
    }

    await client.query("COMMIT");

    await analyticsService.trackEvent("quote_created", {
      organisationId,
      metadata: {
        estimateId: estimate.id,
        total: estimate.total
      }
    });

    return { ...estimate, items: savedItems };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Met à jour une soumission existante.
 */
async function updateEstimate(estimateId, organisationId, data) {
  const { status, issue_date, valid_until, notes } = data;

  const updates = [];
  const values = [estimateId, organisationValue(organisationId)];
  let counter = 3;

  if (status !== undefined) {
    updates.push(`status = $${counter++}`);
    values.push(status);
  }
  if (issue_date !== undefined) {
    updates.push(`issue_date = $${counter++}`);
    values.push(issue_date);
  }
  if (valid_until !== undefined) {
    updates.push(`valid_until = $${counter++}`);
    values.push(valid_until);
  }
  if (notes !== undefined) {
    updates.push(`notes = $${counter++}`);
    values.push(notes);
  }

  if (updates.length === 0) return getEstimateById(estimateId, organisationId);

  const query = `
    UPDATE estimates 
    SET ${updates.join(", ")}
    WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
    RETURNING *
  `;

  const res = await db.query(query, values);
  const updatedEstimate = res.rows[0] || null;

  if (updatedEstimate && status === "accepted") {
    await analyticsService.trackEvent("quote_accepted", {
      organisationId,
      metadata: {
        estimateId: updatedEstimate.id,
        total: updatedEstimate.total
      }
    });
  }

  return updatedEstimate;
}

/**
 * Supprime une soumission de manière logique.
 */
async function deleteEstimate({ estimateId, organisationId }) {
  const res = await db.query(
    `UPDATE estimates 
     SET deleted_at = CURRENT_TIMESTAMP 
     WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [estimateId, organisationValue(organisationId)]
  );
  return res.rows[0] || null;
}

module.exports = {
  createEstimate,
  updateEstimate,
  deleteEstimate
};
