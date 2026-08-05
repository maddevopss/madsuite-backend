// Étage 9 PR F — Évaluation et jeux de référence (issue #195).
// Contrairement aux autres tests de ce chantier, celui-ci n'utilise
// aucune base de données : le moteur de recommandation
// (generateIncidentRecommendation) est une fonction pure, donc les
// scénarios de référence (src/ai/incidentRecommendationEvaluation.js)
// s'exécutent directement contre lui. Chaque scénario est vérifié
// individuellement (message d'échec précis), puis le taux de réussite
// global est vérifié à 100% — c'est le seuil qui bloque une régression
// silencieuse du moteur.
const { buildScenarios, evaluateRecommendationEngine, ENGINE_CONTRACT } = require("../ai/incidentRecommendationEvaluation");
const { generateIncidentRecommendation } = require("../ai/generateIncidentRecommendation");

describe("Évaluation du moteur de recommandation — jeux de référence (Étage 9 PR F)", () => {
  const scenarios = buildScenarios();

  test.each(scenarios.map((s) => [s.id, s]))("%s", (_id, scenario) => {
    const result = generateIncidentRecommendation(scenario.context);
    expect(scenario.expect(result)).toBe(true);
  });

  test("le taux de réussite global du jeu de référence est de 100% — seuil bloquant une régression", () => {
    const evaluation = evaluateRecommendationEngine(scenarios);
    if (evaluation.passRate < 1) {
      const failed = evaluation.results.filter((r) => !r.passed).map((r) => `${r.id}${r.error ? ` (${r.error})` : ""}`);
      throw new Error(`Régression détectée dans le moteur de recommandation : ${failed.join(", ")}`);
    }
    expect(evaluation.passRate).toBe(1);
    expect(evaluation.total).toBeGreaterThanOrEqual(8);
  });

  test("le contrat du moteur reste versionné explicitement", () => {
    expect(ENGINE_CONTRACT).toBe("ai-recommendation@1");
  });

  test("les scénarios sont réellement reproductibles : deux exécutions du même jeu donnent le même résultat", () => {
    const first = evaluateRecommendationEngine(buildScenarios());
    const second = evaluateRecommendationEngine(buildScenarios());
    expect(second.passRate).toBe(first.passRate);
    expect(second.results.map((r) => r.passed)).toEqual(first.results.map((r) => r.passed));
  });
});
