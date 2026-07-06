const db = require("../../db");
const logger = require("../config/logger");

/**
 * Expire les trials qui ont dépassé trial_ends_at.
 * 
 * Règles strictes :
 * - Ne modifie que subscription_status = 'trialing' → 'expired'
 * - Ignore les orgs avec subscription_status = 'active' (payées)
 * - Ignore les orgs avec plan_type IN ('admin', 'internal', 'master_admin', 'platform_admin')
 * - Idempotent : peut être appelé plusieurs fois sans effet
 * 
 * @returns {Promise<{status: string, expired_count: number, organisations: Array}>}
 */
async function expireTrials() {
  const client = await db.pool.connect();
  try {
    const result = await client.query(`
      UPDATE organisations
      SET subscription_status = 'expired'
      WHERE 
        trial_ends_at IS NOT NULL
        AND trial_ends_at < NOW()
        AND subscription_status = 'trialing'
        AND plan_type NOT IN ('admin', 'internal', 'master_admin', 'platform_admin')
      RETURNING id, nom, trial_ends_at
    `);

    if (result.rowCount > 0) {
      logger.info(`Trial expiration: ${result.rowCount} organisation(s) expirée(s)`, {
        organisations: result.rows.map(r => ({ id: r.id, nom: r.nom }))
      });
    }

    return {
      status: 'success',
      expired_count: result.rowCount,
      organisations: result.rows
    };
  } catch (err) {
    logger.error("Erreur lors de l'expiration des trials", { error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  expireTrials
};
