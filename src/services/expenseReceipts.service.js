const db = require("../../db");

const MAX_RECEIPT_SIZE = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function sanitizeFilename(value) {
  let decoded = String(value || "preuve-achat");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Conserver la valeur d'origine si l'en-tête n'était pas encodé.
  }
  const cleaned = decoded
    .replace(/[\r\n]/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/[^\p{L}\p{N}._ -]/gu, "_")
    .trim();
  return cleaned.slice(0, 255) || "preuve-achat";
}

function validateReceipt({ content, mimeType, filename }) {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    const error = new Error("Format de preuve d'achat non permis.");
    error.statusCode = 415;
    throw error;
  }
  if (!Buffer.isBuffer(content) || content.length === 0) {
    const error = new Error("La preuve d'achat est vide.");
    error.statusCode = 400;
    throw error;
  }
  if (content.length > MAX_RECEIPT_SIZE) {
    const error = new Error("La preuve d'achat dépasse la limite de 5 Mo.");
    error.statusCode = 413;
    throw error;
  }
  return { filename: sanitizeFilename(filename), mimeType, sizeBytes: content.length };
}

async function assertExpense({ expenseId, organisationId, executor = db }) {
  const { rows } = await executor.query(
    `SELECT id FROM expenses
     WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
    [expenseId, organisationId],
  );
  if (!rows[0]) {
    const error = new Error("Dépense introuvable.");
    error.statusCode = 404;
    throw error;
  }
}

async function saveReceipt({ expenseId, organisationId, content, mimeType, filename }) {
  const metadata = validateReceipt({ content, mimeType, filename });
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertExpense({ expenseId, organisationId, executor: client });
    await client.query(
      `INSERT INTO expense_receipts
         (expense_id, organisation_id, filename, mime_type, size_bytes, content)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (expense_id) DO UPDATE SET
         organisation_id = EXCLUDED.organisation_id,
         filename = EXCLUDED.filename,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         content = EXCLUDED.content`,
      [expenseId, organisationId, metadata.filename, metadata.mimeType, metadata.sizeBytes, content],
    );
    const { rows } = await client.query(
      `UPDATE expenses SET
         receipt_filename = $3,
         receipt_mime_type = $4,
         receipt_size_bytes = $5,
         receipt_uploaded_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND organisation_id = $2
       RETURNING id, receipt_filename, receipt_mime_type, receipt_size_bytes, receipt_uploaded_at`,
      [expenseId, organisationId, metadata.filename, metadata.mimeType, metadata.sizeBytes],
    );
    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

async function getReceipt({ expenseId, organisationId }) {
  const { rows } = await db.query(
    `SELECT r.filename, r.mime_type, r.size_bytes, r.content
     FROM expense_receipts r
     JOIN expenses e ON e.id = r.expense_id
     WHERE r.expense_id = $1
       AND r.organisation_id = $2
       AND e.organisation_id = $2
       AND e.deleted_at IS NULL`,
    [expenseId, organisationId],
  );
  return rows[0] || null;
}

async function deleteReceipt({ expenseId, organisationId }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await assertExpense({ expenseId, organisationId, executor: client });
    const { rowCount } = await client.query(
      `DELETE FROM expense_receipts WHERE expense_id = $1 AND organisation_id = $2`,
      [expenseId, organisationId],
    );
    await client.query(
      `UPDATE expenses SET
         receipt_filename = NULL,
         receipt_mime_type = NULL,
         receipt_size_bytes = NULL,
         receipt_uploaded_at = NULL
       WHERE id = $1 AND organisation_id = $2`,
      [expenseId, organisationId],
    );
    await client.query("COMMIT");
    return rowCount > 0;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => null);
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_RECEIPT_SIZE,
  deleteReceipt,
  getReceipt,
  sanitizeFilename,
  saveReceipt,
  validateReceipt,
};
