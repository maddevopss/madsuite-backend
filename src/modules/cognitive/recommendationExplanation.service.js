'use strict';

function explainRecommendation({ recommendation, reasons = [], evidence = [], confidence = null }) {
  return { recommendation, reasons, evidence, confidence, humanDecisionRequired: true };
}

module.exports = { explainRecommendation };
