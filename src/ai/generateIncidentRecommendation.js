'use strict';

// Étage 9 PR C — Recommandations et explications (issue #195).
// Fonction pure : transforme un contexte assemblé (PR B) en recommandation
// structurée. Ne fait AUCUN appel réseau/LLM — reste déterministe et
// entièrement explicable à partir des données déjà citées en provenance
// par la PR B. Chaque élément explicatif est étiqueté 'fact', 'calculation'
// ou 'hypothesis' pour ne jamais laisser une supposition se faire passer
// pour un constat ; la 'suggestion' elle-même est toujours distincte des
// trois. Aucune recommandation n'est produite si le contexte ne cite
// aucune source interne identifiable (context.knownErrors vide).

const REASON_NO_SOURCE = 'no_internal_source';

function computeConfidence(knownErrors) {
  const mostRecent = knownErrors[0];
  const ageDays = (Date.now() - new Date(mostRecent.closedAt).getTime()) / 86400000;
  if (knownErrors.length >= 2 && ageDays <= 90) return 'high';
  if (ageDays <= 180) return 'medium';
  return 'low';
}

function generateIncidentRecommendation(context) {
  if (!context || !Array.isArray(context.knownErrors) || context.knownErrors.length === 0) {
    return { recommendation: null, reason: REASON_NO_SOURCE };
  }

  const [topMatch, ...otherMatches] = context.knownErrors;
  const confidence = computeConfidence(context.knownErrors);

  const facts = context.knownErrors.map((knownError) => ({
    type: 'fact',
    statement: `Une erreur connue (#${knownError.problemId}) existe pour le service '${context.subject.serviceKey}', fermée le ${knownError.closedAt}.`,
    source: { problemId: knownError.problemId },
  }));

  const calculations = [{
    type: 'calculation',
    statement: `${context.knownErrors.length} erreur(s) connue(s) trouvée(s) pour ce service dans cette organisation.`,
    value: context.knownErrors.length,
  }];

  const hypotheses = [{
    type: 'hypothesis',
    statement: "Le contournement documenté pour une erreur connue passée est supposé applicable à l'incident actuel — non garanti : la cause de l'incident actuel peut différer même si le service et les symptômes se ressemblent.",
  }];

  const suggestion = {
    type: 'suggestion',
    text: `Essayer le contournement documenté de l'erreur connue #${topMatch.problemId} : "${topMatch.workaround}"`,
  };

  const limits = [
    "Cette suggestion ne constate pas la cause de l'incident actuel — elle rapproche seulement un symptôme (service) d'un historique documenté.",
    `Contexte valide jusqu'au ${context.validity.validUntil} — au-delà, il doit être régénéré avant toute nouvelle décision.`,
  ];
  if (otherMatches.length > 0) {
    limits.push(`${otherMatches.length} autre(s) erreur(s) connue(s) existent pour ce service — seule la plus récente est suggérée en premier, les autres restent listées en preuves.`);
  }

  return {
    recommendation: {
      contract: 'ai-recommendation@1',
      useCaseId: context.useCaseId,
      subject: context.subject,
      suggestion,
      facts,
      calculations,
      hypotheses,
      confidence,
      limits,
      evidence: context.provenance,
      generatedAt: context.validity.fetchedAt,
      expiresAt: context.validity.validUntil,
    },
  };
}

module.exports = { generateIncidentRecommendation, REASON_NO_SOURCE };
