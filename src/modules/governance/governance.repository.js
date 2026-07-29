'use strict';

class GovernanceRepository {
  constructor(db) {
    if (!db || typeof db.query !== 'function') throw new TypeError('db_required');
    this.db = db;
  }

  async withTransaction(work) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendTransition({ command, targetState, event, integrity }) {
    return this.withTransaction(async (client) => {
      const commandResult = await client.query(
        `INSERT INTO governance_commands
          (id, governance_case_id, organisation_id, actor_id, action, idempotency_key, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (organisation_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [command.id, command.caseId, command.organisationId, command.actorId, command.action, command.idempotencyKey, command.payload || {}],
      );

      if (commandResult.rowCount === 0) {
        const duplicate = new Error('GOVERNANCE_IDEMPOTENCY_CONFLICT');
        duplicate.code = 'GOVERNANCE_IDEMPOTENCY_CONFLICT';
        throw duplicate;
      }

      await client.query(
        'UPDATE governance_cases SET state = $1, updated_at = NOW() WHERE id = $2 AND organisation_id = $3',
        [targetState, command.caseId, command.organisationId],
      );

      await client.query(
        `INSERT INTO governance_events
          (id, governance_case_id, organisation_id, event_type, actor_id, payload, integrity_hash, integrity_signature)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [event.id, command.caseId, command.organisationId, event.type, command.actorId, event.payload || {}, integrity.hash, integrity.signature],
      );

      return Object.freeze({ commandId: command.id, state: targetState, eventId: event.id });
    });
  }
}

module.exports = { GovernanceRepository };
