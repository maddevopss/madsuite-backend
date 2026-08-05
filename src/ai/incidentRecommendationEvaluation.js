'use strict';

// Étage 9 PR F — Évaluation et jeux de référence (issue #195).
// Jeu de scénarios REPRODUCTIBLES pour le moteur de recommandation
// (src/ai/generateIncidentRecommendation.js) : mêmes entrées structurées
// que celles réellement produites par le contexte de la PR B
// (assembleIncidentKnownErrorContext), jamais un appel réseau/LLM — donc
// une exécution répétée du même scénario doit toujours produire le même
// résultat (les dates sont relatives à "maintenant" au moment de la
// construction du scénario, pas des dates absolues figées qui dériveraient
// de bande de confiance avec le temps qui passe).
//
// Chaque scénario vérifie un aspect du critère de fermeture de l'Étage 9 :
// exactitude factuelle (facts.source correspond aux données fournies),
// pertinence (le service/l'erreur suggérée correspondent au sujet),
// refus (aucune recommandation fabriquée sans source), absence de fuite
// (le sujet renvoyé est exactement celui fourni, jamais un autre).

const { generateIncidentRecommendation } = require('./generateIncidentRecommendation');

const ENGINE_CONTRACT = 'ai-recommendation@1';

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildContext({ knownErrors = [], serviceKey = 'svc-eval', incidentId = 'inc-eval-1', severity = 'high', organisationId = 1 }) {
  const fetchedAt = new Date();
  const validUntil = new Date(fetchedAt.getTime() + 15 * 60 * 1000);
  return {
    contract: 'ai-institutional-context@1',
    useCaseId: 'incident-known-error-suggestion',
    organisationId,
    subject: { incidentId, serviceKey, severity },
    knownErrors,
    provenance: knownErrors.map((k) => ({ source: 'operational_problems', id: k.problemId, matchedBy: 'linked_incident.service_key', fetchedAt: fetchedAt.toISOString() })),
    validity: { fetchedAt: fetchedAt.toISOString(), validUntil: validUntil.toISOString() },
  };
}

function buildScenarios() {
  return [
    {
      id: 'refuse-without-internal-source',
      description: "Aucune erreur connue → aucune recommandation fabriquée, raison explicite.",
      context: buildContext({ knownErrors: [] }),
      expect(result) {
        return result.recommendation === null && result.reason === 'no_internal_source';
      },
    },
    {
      id: 'single-old-known-error-low-confidence',
      description: "Une seule erreur connue ancienne (200j) → confiance faible, suggestion cite son contournement réel.",
      context: buildContext({
        knownErrors: [{ problemId: 101, title: 'Ancienne panne', workaround: 'Redémarrer le service de paiement', closedAt: daysAgo(200) }],
      }),
      expect(result) {
        const r = result.recommendation;
        return Boolean(r) && r.confidence === 'low' && r.suggestion.text.includes('Redémarrer le service de paiement');
      },
    },
    {
      id: 'single-mid-age-known-error-medium-confidence',
      description: "Une seule erreur connue d'âge intermédiaire (150j) → confiance moyenne.",
      context: buildContext({
        knownErrors: [{ problemId: 301, title: 'Panne intermédiaire', workaround: 'Vider la file bloquée', closedAt: daysAgo(150) }],
      }),
      expect(result) {
        return result.recommendation?.confidence === 'medium';
      },
    },
    {
      id: 'two-recent-known-errors-high-confidence',
      description: "Deux erreurs connues récentes (≤90j) → confiance élevée.",
      context: buildContext({
        knownErrors: [
          { problemId: 201, title: 'Panne récente A', workaround: 'Purger le cache', closedAt: daysAgo(2) },
          { problemId: 202, title: 'Panne récente B', workaround: 'Redémarrer le worker', closedAt: daysAgo(10) },
        ],
      }),
      expect(result) {
        return result.recommendation?.confidence === 'high';
      },
    },
    {
      id: 'factual-accuracy-sources-match-input',
      description: "Chaque fait cité référence exactement un problemId présent dans les erreurs connues fournies — aucun fait inventé.",
      context: buildContext({
        knownErrors: [
          { problemId: 401, title: 'A', workaround: 'Contournement A', closedAt: daysAgo(5) },
          { problemId: 402, title: 'B', workaround: 'Contournement B', closedAt: daysAgo(6) },
        ],
      }),
      expect(result) {
        const r = result.recommendation;
        if (!r) return false;
        const inputIds = new Set([401, 402]);
        return r.facts.every((f) => f.type === 'fact' && inputIds.has(Number(f.source.problemId)));
      },
    },
    {
      id: 'taxonomy-and-contract-stable',
      description: "Le contrat versionné et la séparation fait/calcul/hypothèse/suggestion restent stables — détecte une dérive silencieuse du moteur.",
      context: buildContext({
        knownErrors: [{ problemId: 501, title: 'C', workaround: 'Contournement C', closedAt: daysAgo(1) }],
      }),
      expect(result) {
        const r = result.recommendation;
        if (!r) return false;
        return r.contract === ENGINE_CONTRACT
          && r.calculations.every((c) => c.type === 'calculation')
          && r.hypotheses.every((h) => h.type === 'hypothesis')
          && r.suggestion.type === 'suggestion'
          && Array.isArray(r.limits) && r.limits.length > 0
          && typeof r.expiresAt === 'string';
      },
    },
    {
      id: 'no-leakage-subject-matches-exact-input',
      description: "Le sujet renvoyé (incident/service) correspond EXACTEMENT à celui fourni en entrée — jamais un autre incident/service implicite.",
      context: buildContext({
        knownErrors: [{ problemId: 601, title: 'D', workaround: 'Contournement D', closedAt: daysAgo(3) }],
        serviceKey: 'svc-eval-isolated',
        incidentId: 'inc-eval-isolated-42',
      }),
      expect(result) {
        const subject = result.recommendation?.subject;
        return subject?.serviceKey === 'svc-eval-isolated' && subject?.incidentId === 'inc-eval-isolated-42';
      },
    },
    {
      id: 'relevance-top-suggestion-is-most-recent',
      description: "Avec plusieurs erreurs connues, la suggestion principale cite la plus récente (la plus pertinente), pas une plus ancienne.",
      context: buildContext({
        knownErrors: [
          { problemId: 701, title: 'Plus récente', workaround: 'Contournement le plus pertinent', closedAt: daysAgo(1) },
          { problemId: 702, title: 'Plus ancienne', workaround: 'Contournement moins pertinent', closedAt: daysAgo(50) },
        ],
      }),
      expect(result) {
        return result.recommendation?.suggestion.text.includes('Contournement le plus pertinent');
      },
    },
  ];
}

function evaluateRecommendationEngine(scenarios = buildScenarios()) {
  const results = scenarios.map((scenario) => {
    const result = generateIncidentRecommendation(scenario.context);
    let passed = false;
    let error = null;
    try {
      passed = Boolean(scenario.expect(result));
    } catch (caught) {
      error = caught.message;
    }
    return { id: scenario.id, description: scenario.description, passed, error };
  });
  const passCount = results.filter((r) => r.passed).length;
  return { total: results.length, passCount, passRate: results.length ? passCount / results.length : 1, results };
}

module.exports = { ENGINE_CONTRACT, buildScenarios, buildContext, daysAgo, evaluateRecommendationEngine };
