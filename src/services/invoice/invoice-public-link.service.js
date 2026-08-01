const crypto = require("crypto");

const db = require("../../../db");
const dbStore = require("../../utils/dbStore");
const { organisationValue } = require("../../utils/organisationScope");
const { getInvoiceById } = require("./invoice-query.service");
const { recordBusinessAudit } = require("../auditLog.service");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ELIGIBLE_STATUSES = new Set(["finalized", "sent", "paid"]);
const DEFAULT_EXPIRY_DAYS = 30;

function hashPublicToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function isValidPublicInvoiceToken(token) {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

function normalizeExpiryDays(value) {
  const days = Number(value || DEFAULT_EXPIRY_DAYS);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    const error = new Error("La durée du lien doit être comprise entre 1 et 365 jours.");
    error.statusCode = 400;
    throw error;
  }
  return days;
}

function buildPublicInvoiceDocument(invoice) {
  if (!invoice) return null;

  return {
    invoice_number: invoice.invoice_number,
    status: invoice.status,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date,
    subtotal: invoice.subtotal,
    tax_total: invoice.tax_total,
    total: invoice.total,
    notes: invoice.notes || null,
    client: {
      name: invoice.client_nom || invoice.client_name || null,
    },
    items: (invoice.items || []).map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_rate: item.unit_rate,
      amount: item.amount,
    })),
  };
}

async function createInvoicePublicLink({
  invoiceId,
  organisationId,
  createdBy,
  baseUrl,
  expiresInDays,
  req,
}) {
  const days = normalizeExpiryDays(expiresInDays);
  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");
    // invoices/invoice_public_links sont sous RLS FORCE : sans ce GUC, aucune
    // ligne n'est visible/écrivable sur cette connexion dédiée.
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationValue(organisationId))]);

    const invoiceResult = await client.query(
      `
      SELECT id, status, invoice_number
      FROM invoices
      WHERE id = $1
        AND organisation_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [invoiceId, organisationValue(organisationId)],
    );

    const invoice = invoiceResult.rows[0];
    if (!invoice) {
      await client.query("ROLLBACK");
      return null;
    }

    if (!ELIGIBLE_STATUSES.has(invoice.status)) {
      const error = new Error("La facture doit être finalisée avant la création d’un lien public.");
      error.statusCode = 409;
      throw error;
    }

    await client.query(
      `
      UPDATE invoice_public_links
      SET revoked_at = NOW()
      WHERE organisation_id = $1
        AND invoice_id = $2
        AND revoked_at IS NULL
      `,
      [organisationValue(organisationId), invoiceId],
    );

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashPublicToken(token);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await client.query(
      `
      INSERT INTO invoice_public_links
        (organisation_id, invoice_id, token_hash, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        organisationValue(organisationId),
        invoiceId,
        tokenHash,
        expiresAt.toISOString(),
        createdBy || null,
      ],
    );

    await client.query("COMMIT");

    await recordBusinessAudit({
      organisationId,
      actorUserId: createdBy || null,
      action: "invoice.public_link_rotated",
      entityType: "invoice",
      entityId: invoiceId,
      details: { expiresAt: expiresAt.toISOString(), expiryDays: days },
      req,
    });

    return {
      portalUrl: `${normalizeBaseUrl(baseUrl)}/portal/${token}`,
      expires_at: expiresAt.toISOString(),
      status: invoice.status,
      invoice_number: invoice.invoice_number,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function revokeInvoicePublicLink({ invoiceId, organisationId, actorUserId, req }) {
  const result = await db.query(
    `
    UPDATE invoice_public_links
    SET revoked_at = NOW()
    WHERE organisation_id = $1
      AND invoice_id = $2
      AND revoked_at IS NULL
    RETURNING id
    `,
    [organisationValue(organisationId), invoiceId],
  );

  if (result.rowCount > 0) {
    await recordBusinessAudit({
      organisationId,
      actorUserId: actorUserId || null,
      action: "invoice.public_link_revoked",
      entityType: "invoice",
      entityId: invoiceId,
      details: {},
      req,
    });
  }

  return { revoked: result.rowCount > 0 };
}

async function getInvoicePublicLinkStatus({ invoiceId, organisationId }) {
  const result = await db.query(
    `
    SELECT expires_at, revoked_at, created_at
    FROM invoice_public_links
    WHERE organisation_id = $1
      AND invoice_id = $2
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [organisationValue(organisationId), invoiceId],
  );

  const link = result.rows[0];
  if (!link) return { active: false, expires_at: null };

  const active = !link.revoked_at && new Date(link.expires_at).getTime() > Date.now();
  return {
    active,
    expires_at: link.expires_at,
    revoked_at: link.revoked_at,
    created_at: link.created_at,
  };
}

async function getPublicInvoiceContextByToken(token) {
  if (!isValidPublicInvoiceToken(token)) return null;

  // La résolution jeton → organisation est intrinsèquement cross-tenant : elle
  // passe par une fonction SECURITY DEFINER étroite (elle ne fait que
  // résoudre + horodater un lien non révoqué et non expiré), jamais par une
  // lecture directe des tables applicatives, bloquée par RLS FORCE.
  const tokenHash = hashPublicToken(token);
  const resolved = await db.query(`SELECT * FROM resolve_invoice_public_link($1)`, [tokenHash]);
  const link = resolved.rows[0];
  if (!link) return null;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(link.organisation_id)]);

    const detail = await client.query(
      `SELECT i.status, o.nom AS organisation_name
       FROM invoices i
       JOIN organisations o ON o.id = i.organisation_id
       WHERE i.id = $1 AND i.organisation_id = $2 AND i.deleted_at IS NULL AND i.status IN ('finalized', 'sent', 'paid')`,
      [link.invoice_id, link.organisation_id],
    );
    const row = detail.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    // getInvoiceById interroge via le module db partagé (respecte le contexte
    // ALS) : on l'exécute sous le contexte de cette connexion déjà scopée,
    // sans avoir à dupliquer sa logique de chargement des lignes.
    const invoice = await dbStore.run(
      { dbClient: client, organisationId: link.organisation_id },
      () => getInvoiceById({ invoiceId: link.invoice_id, organisationId: link.organisation_id }),
    );
    if (!invoice) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query("COMMIT");

    return {
      type: "invoice",
      organisationId: link.organisation_id,
      organisationName: row.organisation_name,
      expiresAt: link.expires_at,
      invoice,
      publicDocument: buildPublicInvoiceDocument(invoice),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DEFAULT_EXPIRY_DAYS,
  hashPublicToken,
  isValidPublicInvoiceToken,
  buildPublicInvoiceDocument,
  createInvoicePublicLink,
  revokeInvoicePublicLink,
  getInvoicePublicLinkStatus,
  getPublicInvoiceContextByToken,
};
