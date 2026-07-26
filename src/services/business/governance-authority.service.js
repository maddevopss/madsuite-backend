function scopeContains(scope, requestedScope) {
  if (!requestedScope) return true;
  if (!Array.isArray(scope)) return false;
  return scope.includes('*') || scope.includes(requestedScope);
}

async function resolveAuthority(client, {
  organisationId,
  actorUserId,
  authorityType,
  requestedScope = null,
  requestedAmount = null,
  subjectType = null,
  subjectId = null,
}) {
  const delegation = (await client.query(`
    SELECT authority_type, scope, financial_limit, starts_at, ends_at
    FROM governance_delegations
    WHERE organisation_id=$1
      AND delegate_user_id=$2
      AND authority_type=$3
      AND status='active'
      AND starts_at<=NOW()
      AND ends_at>=NOW()
    ORDER BY financial_limit DESC NULLS FIRST, ends_at DESC
    LIMIT 1
    FOR UPDATE
  `, [organisationId, actorUserId, authorityType])).rows[0] || null;

  const conflict = (await client.query(`
    SELECT id
    FROM governance_conflicts
    WHERE organisation_id=$1
      AND declarant_user_id=$2
      AND status IN ('declared','active')
      AND ($3::text IS NULL OR subject_type=$3)
      AND ($4::text IS NULL OR subject_id=$4)
    LIMIT 1
  `, [organisationId, actorUserId, subjectType, subjectId == null ? null : String(subjectId)])).rows[0] || null;

  return {
    actorUserId,
    authorityType,
    withinScope: Boolean(delegation && scopeContains(delegation.scope, requestedScope)),
    withinPeriod: Boolean(delegation),
    financialLimit: delegation?.financial_limit ?? null,
    requestedAmount,
    activeConflict: Boolean(conflict),
  };
}

module.exports = { resolveAuthority, scopeContains };
