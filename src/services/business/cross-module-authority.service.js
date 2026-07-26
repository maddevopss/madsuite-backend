const { resolveAuthority } = require('./governance-authority.service');

function authorityIsValid(authority) {
  if (!authority) return false;
  const withinFinancialLimit = authority.requestedAmount == null
    || authority.financialLimit == null
    || Number(authority.requestedAmount) <= Number(authority.financialLimit);
  return authority.withinScope
    && authority.withinPeriod
    && !authority.activeConflict
    && withinFinancialLimit;
}

async function validateCrossModuleAuthority(client, {
  organisationId,
  actorUserId,
  authorityType,
  requestedScope = null,
  requestedAmount = null,
  subjectType,
  subjectId,
  evidence = [],
  idempotencyKey,
}) {
  if (!organisationId || !actorUserId || !authorityType || !subjectType || subjectId == null) {
    const error = new Error('governance.cross_module_authority_fields_required');
    error.statusCode = 400;
    throw error;
  }
  if (!idempotencyKey || String(idempotencyKey).trim().length < 8) {
    const error = new Error('governance.idempotency_required');
    error.statusCode = 400;
    throw error;
  }

  const existing = (await client.query(
    'SELECT * FROM governance_authority_validations WHERE organisation_id=$1 AND idempotency_key=$2 FOR UPDATE',
    [organisationId, idempotencyKey],
  )).rows[0];
  if (existing) return { duplicate: true, validation: existing };

  const authority = await resolveAuthority(client, {
    organisationId,
    actorUserId,
    authorityType,
    requestedScope,
    requestedAmount,
    subjectType,
    subjectId,
  });
  const valid = authorityIsValid(authority);

  const validation = (await client.query(`
    INSERT INTO governance_authority_validations
      (organisation_id,actor_user_id,authority_type,requested_scope,requested_amount,subject_type,subject_id,valid,within_scope,within_period,active_conflict,financial_limit,evidence,idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    RETURNING *
  `, [
    organisationId,
    actorUserId,
    authorityType,
    requestedScope,
    requestedAmount,
    subjectType,
    String(subjectId),
    valid,
    authority.withinScope,
    authority.withinPeriod,
    authority.activeConflict,
    authority.financialLimit,
    evidence,
    idempotencyKey,
  ])).rows[0];

  return { duplicate: false, validation, authority };
}

module.exports = { authorityIsValid, validateCrossModuleAuthority };
