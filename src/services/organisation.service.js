const db = require("../../db");

/**
 * Récupère les paramètres de rétention d'une organisation
 */
async function getOrganisationSettings(organisationId) {
  const query = `
    SELECT id, nom, retention_activity_logs_days, retention_summary_days, retention_audit_logs_days,
           interac_email, interac_question, kiosk_token
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

module.exports = {
  updateOrganisationRetention,
  getOrganisationSettings,
  getOrganisationAuditLogs,
  getOrganisationAuditLogsForExport,
};
