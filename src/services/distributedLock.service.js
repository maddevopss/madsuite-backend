const { pool } = require("../../db");
const logger = require("../config/logger");

const activeLocks = new Map();

/**
 * Tente d'acquérir un verrou distribué basé sur PostgreSQL.
 * @param {string} jobName
 * @returns {Promise<boolean>} true si obtenu, false sinon
 */
async function acquireLock(jobName) {
  if (activeLocks.has(jobName)) {
    return false;
  }

  const client = await pool.connect();
  try {
    const query = `SELECT pg_try_advisory_lock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint) AS acquired`;
    const { rows } = await client.query(query, [jobName]);

    if (rows[0].acquired) {
      activeLocks.set(jobName, client);
      return true;
    } else {
      client.release();
      return false;
    }
  } catch (error) {
    client.release();
    logger.error(`Erreur acquireLock pour ${jobName}:`, error);
    return false;
  }
}

/**
 * Relâche un verrou distribué précédemment acquis.
 * @param {string} jobName
 */
async function releaseLock(jobName) {
  const client = activeLocks.get(jobName);
  if (!client) {
    return;
  }

  try {
    const query = `SELECT pg_advisory_unlock(('x' || substr(md5($1), 1, 16))::bit(64)::bigint) AS released`;
    await client.query(query, [jobName]);
  } catch (error) {
    logger.error(`Erreur releaseLock pour ${jobName}:`, error);
  } finally {
    client.release();
    activeLocks.delete(jobName);
  }
}

module.exports = {
  acquireLock,
  releaseLock
};
