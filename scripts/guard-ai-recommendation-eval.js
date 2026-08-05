#!/usr/bin/env node
'use strict';

// Étage 9 PR F — Évaluation et jeux de référence (issue #195).
// Garde-fou CI : rejoue le jeu de scénarios de référence du moteur de
// recommandation (src/ai/incidentRecommendationEvaluation.js) et bloque
// le pipeline si le taux de réussite descend sous 100%. Contrairement à
// npm test (qui échouerait aussi), ce garde-fou tourne dans "Backend PR
// Guards" indépendamment de la suite Jest complète — un seuil de
// régression explicite pour ce moteur précis, pas noyé dans ~2700 autres
// tests.

const { buildScenarios, evaluateRecommendationEngine } = require('../src/ai/incidentRecommendationEvaluation');

const evaluation = evaluateRecommendationEngine(buildScenarios());

if (evaluation.passRate < 1) {
  console.error('Garde-fou d\'évaluation du moteur de recommandation IA : régression détectée.\n');
  evaluation.results
    .filter((r) => !r.passed)
    .forEach((r) => console.error(`- ${r.id}: ${r.description}${r.error ? ` (erreur : ${r.error})` : ''}`));
  console.error(`\nTaux de réussite : ${(evaluation.passRate * 100).toFixed(1)}% (${evaluation.passCount}/${evaluation.total}) — seuil requis : 100%.`);
  process.exit(1);
}

console.log(`Garde-fou d'évaluation IA : ${evaluation.passCount}/${evaluation.total} scénarios de référence passent (100%).`);
