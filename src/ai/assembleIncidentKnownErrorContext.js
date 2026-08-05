'use strict';

// Étage 9 PR B — Contexte institutionnel contrôlé (issue #195).
// Assemble le contexte pour le cas d'usage 'incident-known-error-suggestion'
// (PR A) : uniquement les erreurs connues du MÊME service et de la MÊME
// organisation que l'incident, avec des champs minimisés (pas d'ids
// internes, pas de blobs de preuve), une provenance explicite par élément
// et une période de validité — jamais un contexte non borné dans le temps
// ni élargi à d'autres organisations. Fonction pure côté requêtage
// (aucune écriture), réutilisable par la route de la PR B et par le
// moteur de recommandation de la PR C sans aller-retour HTTP.

const CONTEXT_VALIDITY_MINUTES = 15;

function minimizeKnownError(row) {
  return {
    problemId: row.id,
    title: row.title,
    workaround: row.workaround,
    closedAt: row.closed_at,
  };
}

async function assembleIncidentKnownErrorContext(db, { organisationId, incidentId }) {
  if (!organisationId) throw Object.assign(new Error('ai.context.organisation_required'), { statusCode: 400 });

  const incident = (await db.query(
    'SELECT id, service_key, severity FROM operational_incidents WHERE id=$1 AND organisation_id=$2',
    [incidentId, organisationId],
  )).rows[0];
  if (!incident) throw Object.assign(new Error('ai.context.incident_not_found'), { statusCode: 404 });

  // operational_problems ne porte pas de service_key propre (il regroupe
  // des incidents potentiellement multi-services) — on ne retient qu'une
  // erreur connue dont AU MOINS un incident lié partage le service_key de
  // l'incident courant, DANS LA MÊME organisation (le EXISTS ci-dessous
  // re-filtre organisation_id explicitement plutôt que de compter
  // implicitement sur RLS pour l'isolation interorganisation).
  const knownErrors = (await db.query(
    `SELECT p.id, p.title, p.workaround, p.closed_at
       FROM operational_problems p
      WHERE p.organisation_id=$1 AND p.status='closed' AND p.closure_type='known_error'
        AND EXISTS (
          SELECT 1 FROM operational_incidents oi
           WHERE oi.organisation_id=$1
             AND oi.service_key=$2
             AND oi.id::text IN (SELECT jsonb_array_elements_text(p.linked_incident_ids))
        )
      ORDER BY p.closed_at DESC`,
    [organisationId, incident.service_key],
  )).rows;

  const fetchedAt = new Date();
  const validUntil = new Date(fetchedAt.getTime() + CONTEXT_VALIDITY_MINUTES * 60 * 1000);

  return {
    contract: 'ai-institutional-context@1',
    useCaseId: 'incident-known-error-suggestion',
    organisationId,
    subject: { incidentId: incident.id, serviceKey: incident.service_key, severity: incident.severity },
    knownErrors: knownErrors.map(minimizeKnownError),
    provenance: knownErrors.map((row) => ({ source: 'operational_problems', id: row.id, matchedBy: 'linked_incident.service_key', fetchedAt: fetchedAt.toISOString() })),
    validity: { fetchedAt: fetchedAt.toISOString(), validUntil: validUntil.toISOString() },
  };
}

module.exports = { assembleIncidentKnownErrorContext, CONTEXT_VALIDITY_MINUTES };
