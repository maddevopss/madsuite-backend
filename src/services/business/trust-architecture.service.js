const crypto = require("crypto");

function normalizeCheck(check) {
  if (!check || !check.code) throw new TypeError("Contrôle de confiance invalide.");
  return {
    code: check.code,
    passed: Boolean(check.passed),
    severity: check.severity || (check.passed ? "info" : "error"),
    explanation: check.explanation || null,
    evidence: check.evidence || [],
  };
}

function buildTrustAssessment({ transactionId, organisationId, checks = [] }) {
  const normalizedChecks = checks.map(normalizeCheck);
  const weightedFailures = normalizedChecks.reduce((total, check) => {
    if (check.passed) return total;
    return total + ({ warning: 5, error: 20, critical: 40 }[check.severity] || 10);
  }, 0);
  const score = Math.max(0, 100 - weightedFailures);
  return {
    assessmentId: crypto.randomUUID(),
    transactionId,
    organisationId,
    score,
    status: score === 100 ? "conforme" : score >= 80 ? "attention" : "non_conforme",
    checks: normalizedChecks,
    assessedAt: new Date().toISOString(),
  };
}

function createGraphEdge({ organisationId, from, to, relation, provenance }) {
  if (!organisationId || !from?.type || from.id == null || !to?.type || to.id == null || !relation) {
    throw new TypeError("Relation métier incomplète.");
  }
  return {
    organisationId,
    from: { type: from.type, id: String(from.id) },
    to: { type: to.type, id: String(to.id) },
    relation,
    provenance: provenance || null,
  };
}

function createCognitiveContext({ objective, currentStep, nextAction, openItems = [], interruptions = [] }) {
  if (!objective) throw new TypeError("Un objectif cognitif est requis.");
  return { objective, currentStep: currentStep || null, nextAction: nextAction || null, openItems, interruptions };
}

function createAgentIntent({ agentId, action, justification, sources = [], requiresApproval = true }) {
  if (!agentId || !action || !justification) throw new TypeError("Intention d’agent incomplète.");
  return { agentId, action, justification, sources, requiresApproval, status: "proposed" };
}

function createSimulation({ organisationId, name, baseVersion, assumptions = [], engineVersion, policyVersions = [] }) {
  if (!organisationId || !name || !baseVersion) throw new TypeError("Simulation incomplète.");
  return {
    simulationId: crypto.randomUUID(), organisationId, name, baseVersion,
    assumptions, engineVersion: engineVersion || "unknown", policyVersions,
    status: "isolated", createdAt: new Date().toISOString(),
  };
}

function createInstitutionalMemoryEntry({ decision, context, evidence = [], supersedes = null, consequences = [] }) {
  if (!decision || !context) throw new TypeError("Entrée de mémoire institutionnelle incomplète.");
  return {
    memoryId: crypto.randomUUID(), decision, context, evidence, supersedes, consequences,
    recordedAt: new Date().toISOString(), immutable: true,
  };
}

module.exports = {
  normalizeCheck,
  buildTrustAssessment,
  createGraphEdge,
  createCognitiveContext,
  createAgentIntent,
  createSimulation,
  createInstitutionalMemoryEntry,
};
