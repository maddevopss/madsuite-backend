const db = require("../../db");

/**
 * Récupère les paramètres de rétention d'une organisation
 * 
 * P0 SECURITY: kiosk_token est retiré du SELECT. 
 * Ce token doit rester secret et ne jamais être exposé via API.
 */
async function getOrganisationSettings(organisationId) {
  const query = `
    SELECT id, nom, retention_activity_logs_days, retention_summary_days, retention_audit_logs_days,
           interac_email, interac_question
    FROM organisations 
    WHERE id = $1;
  `;
  const res = await db.query(query, [organisationId]);

  if (res.rowCount === 0) return null;
  return res.rows[0];
}

/**
 * Récupère les logs d'audit d'une organisation
 */
async function getOrganisationAuditLogs(organisationId, limit = 50, offset = 0, email = null, action = null) {
  const query = `
    SELECT bal.*, u.email as utilisateur_email, count(*) OVER() AS total_count
    FROM business_audit_logs bal
    LEFT JOIN utilisateurs u ON bal.actor_user_id = u.id
    WHERE bal.organisation_id = $1
      AND ($4::text IS NULL OR u.email ILIKE '%' || $4 || '%')
      AND ($5::text IS NULL OR bal.action ILIKE '%' || $5 || '%')
    ORDER BY bal.created_at DESC
    LIMIT $2 OFFSET $3;
  `;
  const res = await db.query(query, [organisationId, limit, offset, email, action]);
  return res.rows;
}

/**
 * Récupère les logs d'audit pour export CSV (limite plus large pour l'export)
 */
async function getOrganisationAuditLogsForExport(organisationId, email = null, action = null) {
  const query = `
    SELECT bal.created_at, u.email as utilisateur_email, bal.action, bal.details
    FROM business_audit_logs bal
    LEFT JOIN utilisateurs u ON bal.actor_user_id = u.id
    WHERE bal.organisation_id = $1
      AND ($2::text IS NULL OR u.email ILIKE '%' || $2 || '%')
      AND ($3::text IS NULL OR bal.action ILIKE '%' || $3 || '%')
    ORDER BY bal.created_at DESC
    LIMIT 5000;
  `;
  const res = await db.query(query, [organisationId, email, action]);
  return res.rows;
}

/**
 * Met à jour les politiques de rétention d'une organisation
 * 
 * P0 SECURITY: kiosk_token est retiré du RETURNING clause
 */
async function updateOrganisationRetention(organisationId, data, userId) {
  const { retention_activity_logs_days, retention_summary_days, retention_audit_logs_days, interac_email, interac_question } = data;

  const query = `
    UPDATE organisations 
    SET 
      retention_activity_logs_days = COALESCE($1, retention_activity_logs_days),
      retention_summary_days = COALESCE($2, retention_summary_days),
      retention_audit_logs_days = COALESCE($3, retention_audit_logs_days),
      interac_email = COALESCE($4, interac_email),
      interac_question = COALESCE($5, interac_question),
      updated_at = NOW()
    WHERE id = $6
    RETURNING id, nom, retention_activity_logs_days, retention_summary_days, retention_audit_logs_days, interac_email, interac_question;
  `;

  const values = [retention_activity_logs_days, retention_summary_days, retention_audit_logs_days, interac_email, interac_question, organisationId];
  const res = await db.query(query, values);

  if (res.rowCount === 0) return null;

  // Ajout d'une trace d'audit pour la conformité
  await db.query(
    `INSERT INTO business_audit_logs (organisation_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [organisationId, userId, "UPDATE_RETENTION_POLICY", "organisation", organisationId, JSON.stringify(data)],
  );

  return res.rows[0];
}

/**
 * Apply plan change coming from Stripe (webhook or reconciliation).
 * THIS IS THE ONLY AUTOMATED PATH allowed to mutate plan_type on organisations.
 *
 * Manual / support changes must go through a documented + audited admin procedure
 * (and should be logged).
 */
async function applyStripePlanUpdate({ organisationId, planType, subscriptionId = null, status = null }) {
  if (!organisationId || !planType) {
    throw new Error("organisationId and planType are required for applyStripePlanUpdate");
  }

  const allowedPlans = ["free", "pro", "enterprise"];
  if (!allowedPlans.includes(planType)) {
    throw new Error(`Invalid planType: ${planType}`);
  }

  const updateParams = [planType];
  let setSql = "plan_type = $1";
  let paramIndex = 2;

  if (subscriptionId) {
    setSql += `, stripe_subscription_id = $${paramIndex++}`;
    updateParams.push(subscriptionId);
  }
  if (status) {
    setSql += `, subscription_status = $${paramIndex++}`;
    updateParams.push(status);
  }

  updateParams.push(organisationId);

  await db.query(
    `UPDATE organisations SET ${setSql} WHERE id = $${paramIndex}`,
    updateParams
  );

  // Mandatory audit trail
  await db.query(
    `INSERT INTO business_audit_logs (organisation_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, NULL, 'plan_type_updated_via_stripe', 'organisation', $1, $2::jsonb)`,
    [organisationId, JSON.stringify({ plan_type: planType, source: "stripe" })]
  );
}

/**
 * Platform-level: list all organisations (for administrateur)
 * 
 * P0 SECURITY: kiosk_token est retiré du SELECT (ne doit jamais être exposé)
 */
async function listAllOrganisations() {
  const res = await db.query(`
    SELECT id, nom, created_at, plan_type, trial_ends_at
    FROM organisations
    ORDER BY created_at DESC
  `);
  return res.rows;
}

/**
 * Platform-level: create a basic organisation (administrateur)
 */
async function createOrganisation({ nom }) {
  if (!nom || nom.trim().length < 2) {
    const err = new Error("Nom d'organisation requis (min 2 caractères)");
    err.statusCode = 400;
    throw err;
  }

  const res = await db.query(
    `INSERT INTO organisations (nom, trial_ends_at) 
     VALUES ($1, NOW() + INTERVAL '14 days') 
     RETURNING id, nom, created_at, plan_type`,
    [nom.trim()]
  );

  return res.rows[0];
}

/**
 * Platform-level: update organisation (e.g. rename)
 */
async function updateOrganisation(organisationId, { nom }) {
  if (!organisationId) {
    const err = new Error("ID organisation requis");
    err.statusCode = 400;
    throw err;
  }

  const fields = [];
  const values = [];
  let idx = 1;

  if (nom && nom.trim()) {
    fields.push(`nom = $${idx++}`);
    values.push(nom.trim());
  }

  if (fields.length === 0) {
    return null;
  }

  fields.push(`updated_at = NOW()`);
  values.push(organisationId);

  const res = await db.query(
    `UPDATE organisations SET ${fields.join(", ")} WHERE id = $${idx} 
     RETURNING id, nom, created_at, plan_type`,
    values
  );

  return res.rows[0] || null;
}

module.exports = {
  updateOrganisationRetention,
  getOrganisationSettings,
  getOrganisationAuditLogs,
  getOrganisationAuditLogsForExport,
  applyStripePlanUpdate,
  listAllOrganisations,
  createOrganisation,
  updateOrganisation,
};