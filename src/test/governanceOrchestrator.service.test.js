// Issue #171 (Étage 3) PR C — le noyau de résolution d'autorité
// (governanceOrchestrator + separationOfDuties/approvalPolicy/exceptionPolicy/
// stopRules/tenantGuard) existait sans un seul test avant ce fichier, alors
// même qu'il compose toute la logique décrite par l'issue ("délégations,
// périodes, portées, conflits et limites financières"). Ces tests couvrent
// le chemin heureux, le refus interorganisation, le conflit de séparation
// des tâches, l'approbation manquante et le mécanisme d'exception.
const { evaluateGovernanceCommand, createGovernanceError, ACTION_TO_STATE } = require("../modules/governance/governanceOrchestrator.service");
const { validateSeparationOfDuties, findDutyConflicts } = require("../modules/governance/separationOfDuties.service");
const { evaluateApprovalPolicy, APPROVAL_MODES } = require("../modules/governance/approvalPolicy.service");
const { validateGovernanceException, canUseException } = require("../modules/governance/exceptionPolicy.service");
const { evaluateStopRules } = require("../modules/governance/stopRules.service");
const { assertSameOrganisation, scopeGovernanceQuery } = require("../modules/governance/security/governanceTenantGuard.service");

function baseCommand(overrides = {}) {
  return {
    organisationId: 1,
    aggregateType: "test_aggregate",
    aggregateId: "agg-1",
    action: "observe",
    actorId: 42,
    idempotencyKey: "cmd-0001",
    ...overrides,
  };
}

describe("governanceOrchestrator.evaluateGovernanceCommand", () => {
  test("chemin heureux : commande valide, même organisation, aucune règle d'arrêt", () => {
    const result = evaluateGovernanceCommand({
      command: baseCommand(),
      resourceOrganisationId: 1,
      stopContext: { hasRequiredEvidence: true, riskAcceptable: true, policyCurrent: true, signatureValid: true },
    });
    expect(result.allowed).toBe(true);
    expect(result.targetState).toBe(ACTION_TO_STATE.observe);
    expect(result.organisationId).toBe("1");
  });

  test("commande invalide (champs manquants) est rejetée avant toute autre vérification", () => {
    expect(() => evaluateGovernanceCommand({
      command: { action: "observe" },
      resourceOrganisationId: 1,
    })).toThrow(/GOVERNANCE_COMMAND_INVALID/);
  });

  test("refus interorganisation : actorOrganisationId ne correspond pas à resourceOrganisationId", () => {
    expect(() => evaluateGovernanceCommand({
      command: baseCommand({ organisationId: 1 }),
      resourceOrganisationId: 2,
    })).toThrow(/GOVERNANCE_CROSS_ORGANISATION_DENIED|cross_organisation/);
  });

  test("conflit de séparation des tâches déclenche l'arrêt d'exécution", () => {
    expect(() => evaluateGovernanceCommand({
      command: baseCommand(),
      resourceOrganisationId: 1,
      assignments: [
        { userId: "42", capability: "execution:perform" },
        { userId: "42", capability: "verification:create" },
      ],
    })).toThrow(/GOVERNANCE_EXECUTION_STOPPED/);
  });

  test("approbation manquante déclenche l'arrêt, une exception active permet de poursuivre", () => {
    const command = baseCommand();
    expect(() => evaluateGovernanceCommand({
      command,
      resourceOrganisationId: 1,
      approvalPolicy: { mode: APPROVAL_MODES.SINGLE, approvals: [] },
    })).toThrow(/GOVERNANCE_EXECUTION_STOPPED/);

    // canUseException est évaluée avec l'heure réelle côté orchestrateur
    // (aucune injection de temps) : fenêtre large englobant l'exécution du test.
    const result = evaluateGovernanceCommand({
      command,
      resourceOrganisationId: 1,
      approvalPolicy: { mode: APPROVAL_MODES.SINGLE, approvals: [] },
      exception: {
        organisationId: 1,
        responsibleUserId: 9,
        justification: "panne fournisseur d'approbation",
        scope: "test_aggregate",
        startsAt: "2020-01-01T00:00:00Z",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    });
    expect(result.exceptionUsed).toBe(true);
    expect(result.allowed).toBe(true);
  });

  test("exception expirée ne lève pas l'arrêt d'exécution", () => {
    expect(() => evaluateGovernanceCommand({
      command: baseCommand(),
      resourceOrganisationId: 1,
      approvalPolicy: { mode: APPROVAL_MODES.SINGLE, approvals: [] },
      exception: {
        organisationId: 1,
        responsibleUserId: 9,
        justification: "expirée",
        scope: "test_aggregate",
        startsAt: "2020-01-01T00:00:00Z",
        expiresAt: "2020-01-02T00:00:00Z",
      },
    })).toThrow(/GOVERNANCE_EXECUTION_STOPPED/);
  });
});

describe("separationOfDuties.validateSeparationOfDuties", () => {
  test("aucun conflit quand les capacités incompatibles sont réparties entre utilisateurs", () => {
    const result = validateSeparationOfDuties([
      { userId: 1, capability: "recommendation:create" },
      { userId: 2, capability: "approval:create" },
    ]);
    expect(result.valid).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  test("détecte un conflit quand le même utilisateur cumule deux capacités incompatibles", () => {
    const conflicts = findDutyConflicts([
      { userId: 7, capability: "decision:decide" },
      { userId: 7, capability: "verification:create" },
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].userId).toBe("7");
  });
});

describe("approvalPolicy.evaluateApprovalPolicy", () => {
  test("mode NONE approuve toujours", () => {
    expect(evaluateApprovalPolicy({ mode: APPROVAL_MODES.NONE }).approved).toBe(true);
  });

  test("mode DUAL exige deux approbateurs distincts", () => {
    const oneApprover = evaluateApprovalPolicy({ mode: APPROVAL_MODES.DUAL, approvals: [{ userId: 1 }] });
    expect(oneApprover.approved).toBe(false);
    const twoApprovers = evaluateApprovalPolicy({ mode: APPROVAL_MODES.DUAL, approvals: [{ userId: 1 }, { userId: 2 }] });
    expect(twoApprovers.approved).toBe(true);
  });

  test("mode HIERARCHICAL exige les rôles requis, pas seulement le nombre", () => {
    const missingRole = evaluateApprovalPolicy({
      mode: APPROVAL_MODES.HIERARCHICAL,
      requiredRoles: ["manager", "director"],
      approvals: [{ userId: 1, role: "manager" }],
    });
    expect(missingRole.approved).toBe(false);
    expect(missingRole.missing).toContain("director");

    const complete = evaluateApprovalPolicy({
      mode: APPROVAL_MODES.HIERARCHICAL,
      requiredRoles: ["manager", "director"],
      approvals: [{ userId: 1, role: "manager" }, { userId: 2, role: "director" }],
    });
    expect(complete.approved).toBe(true);
  });
});

describe("exceptionPolicy", () => {
  test("rejette une exception avec champs manquants", () => {
    expect(validateGovernanceException({}).valid).toBe(false);
  });

  test("rejette une période invalide (expiration avant début)", () => {
    const result = validateGovernanceException({
      organisationId: 1, responsibleUserId: 1, justification: "x", scope: "y",
      startsAt: "2026-08-10T00:00:00Z", expiresAt: "2026-08-01T00:00:00Z",
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("invalid_exception_period");
  });

  test("canUseException refuse une exception d'une autre organisation", () => {
    const exception = {
      organisationId: 1, responsibleUserId: 1, justification: "x", scope: "y",
      startsAt: "2020-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
    };
    const result = canUseException(exception, { organisationId: 2 });
    expect(result.active).toBe(false);
    expect(result.reason).toBe("cross_organisation_exception");
  });
});

describe("stopRules.evaluateStopRules", () => {
  test("aucune règle déclenchée : exécution permise", () => {
    const result = evaluateStopRules({
      hasRequiredEvidence: true, hasRequiredApprovals: true, riskAcceptable: true,
      policyCurrent: true, hasDutyConflict: false, signatureValid: true,
    });
    expect(result.allowed).toBe(true);
    expect(result.stopped).toBe(false);
  });

  test("plusieurs règles déclenchées sont toutes rapportées", () => {
    const result = evaluateStopRules({ hasRequiredEvidence: false, riskAcceptable: false });
    expect(result.stopped).toBe(true);
    expect(result.reasons).toEqual(expect.arrayContaining(["missing_evidence", "unacceptable_risk"]));
  });
});

describe("governanceTenantGuard", () => {
  test("assertSameOrganisation refuse un contexte manquant", () => {
    expect(() => assertSameOrganisation({ actorOrganisationId: null, resourceOrganisationId: 1 })).toThrow(/organisation_context_required/);
  });

  test("assertSameOrganisation refuse un accès interorganisation", () => {
    expect(() => assertSameOrganisation({ actorOrganisationId: 1, resourceOrganisationId: 2 })).toThrow(/cross_organisation_access_denied/);
  });

  test("scopeGovernanceQuery refuse un filtre qui tente de forcer une autre organisation", () => {
    expect(() => scopeGovernanceQuery(1, { organisationId: 2 })).toThrow(/organisation_filter_override_denied/);
  });

  test("scopeGovernanceQuery ajoute l'organisation aux filtres sans elle", () => {
    expect(scopeGovernanceQuery(1, { state: "open" })).toEqual({ state: "open", organisationId: "1" });
  });
});

test("createGovernanceError attache un code et des détails exploitables", () => {
  const error = createGovernanceError("TEST_CODE", { foo: "bar" });
  expect(error.code).toBe("TEST_CODE");
  expect(error.details).toEqual({ foo: "bar" });
});
