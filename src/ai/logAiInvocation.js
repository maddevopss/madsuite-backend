'use strict';

// Étage 9 PR E — Journal d'audit de l'intelligence (issue #195).
// Écrit une ligne d'audit pour une invocation réelle du moteur (PR C).
// Masque volontairement le texte métier (titre/contournement des erreurs
// connues) — ne conserve que des identifiants, compteurs et un résumé du
// résultat. La conservation est dérivée du risk_level déclaré au
// catalogue (PR A) pour la version du cas d'usage réellement utilisée.
// Étage 9 PR G — enregistre aussi la latence réelle de génération
// (duration_ms), mesurée par l'appelant, pour la surveillance des
// dérives et coûts par cas d'usage.

const RETENTION_DAYS_BY_RISK = { low: 90, medium: 180, high: 365, critical: 730 };

function retentionClassForRisk(riskLevel) {
  if (riskLevel === 'critical' || riskLevel === 'high') return 'extended';
  if (riskLevel === 'medium') return 'standard';
  return 'short';
}

async function logAiInvocation(db, { organisationId, useCaseId, useCaseVersion, requestedBy, context, recommendation, reason, durationMs }) {
  const catalogEntry = (await db.query(
    'SELECT risk_level FROM ai_use_cases WHERE id=$1 AND version=$2',
    [useCaseId, useCaseVersion],
  )).rows[0];
  const riskLevel = catalogEntry?.risk_level || 'medium';
  const retentionClass = retentionClassForRisk(riskLevel);
  const retentionDays = RETENTION_DAYS_BY_RISK[riskLevel] ?? RETENTION_DAYS_BY_RISK.medium;
  const retentionUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

  // Champs minimisés : identifiants et compteurs, jamais le texte métier
  // (titre d'incident, titre/contournement d'erreur connue).
  const requestContext = { incidentId: context.subject.incidentId, serviceKey: context.subject.serviceKey, severity: context.subject.severity };
  const authorizedContextSummary = {
    knownErrorCount: context.knownErrors.length,
    knownErrorIds: context.knownErrors.map((k) => k.problemId),
    validUntil: context.validity.validUntil,
  };
  const resultSummary = recommendation
    ? { hasRecommendation: true, confidence: recommendation.confidence, expiresAt: recommendation.expiresAt }
    : { hasRecommendation: false, reason };

  const { rows } = await db.query(
    `INSERT INTO ai_audit_log (
       organisation_id, use_case_id, use_case_version, engine_contract, request_context,
       authorized_context_summary, result_summary, correlation, retention_class, retention_until, requested_by, duration_ms
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      organisationId,
      useCaseId,
      useCaseVersion,
      'ai-recommendation@1',
      JSON.stringify(requestContext),
      JSON.stringify(authorizedContextSummary),
      JSON.stringify(resultSummary),
      JSON.stringify({ objectType: 'operational_incident', objectId: context.subject.incidentId }),
      retentionClass,
      retentionUntil.toISOString(),
      requestedBy || null,
      Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    ],
  );
  return rows[0];
}

module.exports = { logAiInvocation, retentionClassForRisk, RETENTION_DAYS_BY_RISK };
