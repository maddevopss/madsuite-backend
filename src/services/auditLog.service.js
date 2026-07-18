const db = require("../../db");
const logger = require("../config/logger");

async function recordBusinessAudit({
  organisationId,
  actorUserId,
  action,
  entityType,
  entityId = null,
  details = {},
  req = null,
  client = db,
  throwOnError = false,
}) {
  if (!organisationId || !action || !entityType) return;

  try {
    await client.query(
      `
      INSERT INTO business_audit_logs (
        organisation_id,
        actor_user_id,
        action,
        entity_type,
        entity_id,
        details,
        ip_address,
        user_agent
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
      `,
      [
        organisationId,
        actorUserId || null,
        action,
        entityType,
        entityId || null,
        JSON.stringify(details || {}),
        req?.ip || null,
        req?.get?.("user-agent") || null,
      ],
    );
  } catch (err) {
    logger.warn("business audit log write failed", {
      error: err.message,
      organisationId,
      actorUserId,
      action,
      entityType,
      entityId,
    });

    if (throwOnError) {
      throw err;
    }
  }
}

module.exports = {
  recordBusinessAudit,
};
