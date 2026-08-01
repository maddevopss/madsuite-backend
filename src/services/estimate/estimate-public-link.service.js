const crypto = require("crypto");

const db = require("../../../db");
const dbStore = require("../../utils/dbStore");
const { organisationValue } = require("../../utils/organisationScope");
const { getEstimateById } = require("./estimate-query.service");
const { recordBusinessAudit } = require("../auditLog.service");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_EXPIRY_DAYS = 30;

function hashPublicToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

function isValidPublicEstimateToken(token) {
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

function buildPublicEstimateDocument(estimate, decision = null) {
  if (!estimate) return null;
  return {
    estimate_number: estimate.estimate_number,
    status: estimate.status,
    issue_date: estimate.issue_date,
    valid_until: estimate.valid_until,
    subtotal: estimate.subtotal,
    tax_total: estimate.tax_total,
    total: estimate.total,
    notes: estimate.notes || null,
    client: { name: estimate.client_nom || null },
    items: (estimate.items || []).map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit_rate: item.unit_rate,
      amount: item.amount,
    })),
    decision: decision ? {
      value: decision.decision,
      signer_name: decision.signer_name,
      decided_at: decision.decided_at,
    } : null,
  };
}

async function createEstimatePublicLink({ estimateId, organisationId, createdBy, baseUrl, expiresInDays, req }) {
  const days = normalizeExpiryDays(expiresInDays);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(organisationValue(organisationId))]);
    const estimateResult = await client.query(
      `SELECT id, status, estimate_number
       FROM estimates
       WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [estimateId, organisationValue(organisationId)],
    );
    const estimate = estimateResult.rows[0];
    if (!estimate) {
      await client.query("ROLLBACK");
      return null;
    }
    if (estimate.status !== "sent") {
      const error = new Error("La soumission doit être envoyée avant la création d’un lien public.");
      error.statusCode = 409;
      throw error;
    }

    await client.query(
      `UPDATE estimate_public_links
       SET revoked_at = NOW()
       WHERE organisation_id = $1 AND estimate_id = $2 AND revoked_at IS NULL`,
      [organisationValue(organisationId), estimateId],
    );

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + days * 86400000);
    await client.query(
      `INSERT INTO estimate_public_links
         (organisation_id, estimate_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [organisationValue(organisationId), estimateId, hashPublicToken(token), expiresAt.toISOString(), createdBy || null],
    );
    await client.query("COMMIT");

    await recordBusinessAudit({
      organisationId,
      actorUserId: createdBy || null,
      action: "estimate.public_link_rotated",
      entityType: "estimate",
      entityId: estimateId,
      details: { expiresAt: expiresAt.toISOString(), expiryDays: days },
      req,
    });

    return {
      portalUrl: `${normalizeBaseUrl(baseUrl)}/portal/${token}`,
      expires_at: expiresAt.toISOString(),
      estimate_number: estimate.estimate_number,
      status: estimate.status,
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function revokeEstimatePublicLink({ estimateId, organisationId, actorUserId, req }) {
  const result = await db.query(
    `UPDATE estimate_public_links SET revoked_at = NOW()
     WHERE organisation_id = $1 AND estimate_id = $2 AND revoked_at IS NULL
     RETURNING id`,
    [organisationValue(organisationId), estimateId],
  );
  if (result.rowCount > 0) {
    await recordBusinessAudit({
      organisationId,
      actorUserId: actorUserId || null,
      action: "estimate.public_link_revoked",
      entityType: "estimate",
      entityId: estimateId,
      details: {},
      req,
    });
  }
  return { revoked: result.rowCount > 0 };
}

async function getEstimatePublicLinkStatus({ estimateId, organisationId }) {
  const result = await db.query(
    `SELECT expires_at, revoked_at, created_at
     FROM estimate_public_links
     WHERE organisation_id = $1 AND estimate_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [organisationValue(organisationId), estimateId],
  );
  const link = result.rows[0];
  if (!link) return { active: false, expires_at: null };
  return {
    active: !link.revoked_at && new Date(link.expires_at).getTime() > Date.now(),
    expires_at: link.expires_at,
    revoked_at: link.revoked_at,
    created_at: link.created_at,
  };
}

async function getPublicEstimateContextByToken(token) {
  if (!isValidPublicEstimateToken(token)) return null;

  // Même principe que le portail facture : résolution jeton → organisation
  // via une fonction SECURITY DEFINER étroite, jamais par une lecture directe
  // bloquée par RLS FORCE.
  const resolved = await db.query(`SELECT * FROM resolve_estimate_public_link($1)`, [hashPublicToken(token)]);
  const link = resolved.rows[0];
  if (!link) return null;

  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(link.organisation_id)]);

    const detail = await client.query(
      `SELECT o.nom AS organisation_name, d.decision, d.signer_name, d.decided_at
       FROM estimates e
       JOIN organisations o ON o.id = e.organisation_id
       LEFT JOIN estimate_public_decisions d ON d.estimate_id = e.id AND d.organisation_id = e.organisation_id
       WHERE e.id = $1 AND e.organisation_id = $2 AND e.deleted_at IS NULL
         AND e.status IN ('sent', 'accepted', 'rejected', 'invoiced')`,
      [link.estimate_id, link.organisation_id],
    );
    const row = detail.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    const estimate = await dbStore.run(
      { dbClient: client, organisationId: link.organisation_id },
      () => getEstimateById(link.estimate_id, link.organisation_id),
    );
    if (!estimate) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query("COMMIT");

    const decision = row.decision ? {
      decision: row.decision,
      signer_name: row.signer_name,
      decided_at: row.decided_at,
    } : null;
    return {
      type: "estimate",
      linkId: link.link_id,
      organisationId: link.organisation_id,
      organisationName: row.organisation_name,
      expiresAt: link.expires_at,
      estimate,
      publicDocument: buildPublicEstimateDocument(estimate, decision),
    };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function decidePublicEstimate({ token, decision, signerName, consentConfirmed, clientIp }) {
  if (!['accepted', 'rejected'].includes(decision)) {
    const error = new Error("Décision invalide.");
    error.statusCode = 400;
    throw error;
  }
  const cleanSignerName = String(signerName || "").trim();
  if (cleanSignerName.length < 2 || cleanSignerName.length > 255) {
    const error = new Error("Le nom du signataire est obligatoire.");
    error.statusCode = 400;
    throw error;
  }
  if (decision === 'accepted' && consentConfirmed !== true) {
    const error = new Error("Le consentement doit être confirmé pour accepter la soumission.");
    error.statusCode = 400;
    throw error;
  }

  const context = await getPublicEstimateContextByToken(token);
  if (!context) return null;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_organisation_id', $1, true)", [String(context.organisationId)]);
    const locked = await client.query(
      `SELECT id, status FROM estimates
       WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [context.estimate.id, context.organisationId],
    );
    const estimate = locked.rows[0];
    if (!estimate) {
      await client.query("ROLLBACK");
      return null;
    }

    const existing = await client.query(
      `SELECT decision, signer_name, decided_at
       FROM estimate_public_decisions
       WHERE organisation_id = $1 AND estimate_id = $2`,
      [context.organisationId, context.estimate.id],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].decision !== decision) {
        const error = new Error("Une décision différente a déjà été enregistrée.");
        error.statusCode = 409;
        throw error;
      }
      await client.query("COMMIT");
      return { duplicate: true, decision: existing.rows[0] };
    }

    if (estimate.status !== "sent") {
      const error = new Error("Cette soumission ne peut plus être modifiée.");
      error.statusCode = 409;
      throw error;
    }

    const inserted = await client.query(
      `INSERT INTO estimate_public_decisions
         (organisation_id, estimate_id, link_id, decision, signer_name,
          consent_confirmed, client_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING decision, signer_name, decided_at`,
      [context.organisationId, context.estimate.id, context.linkId, decision, cleanSignerName, consentConfirmed === true, clientIp || null],
    );
    await client.query(
      `UPDATE estimates
       SET status = $1,
           signature_data = CASE WHEN $1 = 'accepted' THEN $2 ELSE signature_data END,
           signed_at = CASE WHEN $1 = 'accepted' THEN NOW() ELSE signed_at END,
           signed_ip = CASE WHEN $1 = 'accepted' THEN $3 ELSE signed_ip END,
           updated_at = NOW()
       WHERE id = $4 AND organisation_id = $5`,
      [decision, cleanSignerName, clientIp || null, context.estimate.id, context.organisationId],
    );
    await client.query("COMMIT");

    await recordBusinessAudit({
      organisationId: context.organisationId,
      actorUserId: null,
      action: `estimate.${decision}_via_secure_portal`,
      entityType: "estimate",
      entityId: context.estimate.id,
      details: { signerName: cleanSignerName, consentConfirmed: consentConfirmed === true },
      req: null,
    });
    return { duplicate: false, decision: inserted.rows[0] };
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
  isValidPublicEstimateToken,
  buildPublicEstimateDocument,
  createEstimatePublicLink,
  revokeEstimatePublicLink,
  getEstimatePublicLinkStatus,
  getPublicEstimateContextByToken,
  decidePublicEstimate,
};