// Issue #171 (Étage 3) PR C — les évaluateurs de domaine sous
// src/modules/governance/integrations/ (payroll/accounting/inventory/
// supplier/cognitive/operations + les deux composeurs génériques) n'avaient
// aucun test avant ce fichier, malgré une logique métier réelle (double
// approbation >= 10000$, séparation préparateur/approbateur, confirmation
// humaine obligatoire pour l'IA, interdiction de mouvement interorganisation...).
const { evaluatePayrollDecision, PAYROLL_ACTIONS } = require("../modules/governance/integrations/payrollGovernance.service");
const { evaluateAccountingDecision } = require("../modules/governance/integrations/accountingGovernance.service");
const { evaluateInventoryMovement } = require("../modules/governance/integrations/inventoryGovernance.service");
const { evaluateSupplierDecision } = require("../modules/governance/integrations/supplierGovernance.service");
const { evaluateCognitiveRecommendation } = require("../modules/governance/integrations/cognitiveAssistanceGovernance.service");
const { evaluateOperationalTransition, OPERATION_STATES } = require("../modules/governance/integrations/operationsGovernance.service");
const { buildFinancialExplanation } = require("../modules/governance/integrations/financialDecisionGovernance.service");
const { createGovernedBusinessAction } = require("../modules/governance/integrations/governedBusinessAction.service");
const { createGovernedAdvisoryExecution } = require("../modules/governance/integrations/governedAdvisoryExecution.service");

describe("payrollGovernance.evaluatePayrollDecision", () => {
  const valid = { organisationId: 1, employeeId: 2, actorId: 3, action: "salary.change", justification: "ajustement annuel", policyId: 9, evidenceIds: ["e1"], approvalIds: ["a1"] };

  test("autorise une décision complète et conforme", () => {
    expect(evaluatePayrollDecision(valid).allowed).toBe(true);
  });

  test("refuse une action inconnue du domaine paie", () => {
    expect(evaluatePayrollDecision({ ...valid, action: "vacation.request" }).reasons).toContain("UNKNOWN_PAYROLL_ACTION");
  });

  test("refuse l'auto-approbation même avec toutes les preuves", () => {
    const result = evaluatePayrollDecision({ ...valid, actorIsBeneficiary: true });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("SELF_APPROVAL_FORBIDDEN");
  });

  test("PAYROLL_ACTIONS couvre les actions sensibles attendues", () => {
    expect(PAYROLL_ACTIONS.has("payroll.correct")).toBe(true);
  });
});

describe("accountingGovernance.evaluateAccountingDecision", () => {
  const base = { organisationId: 1, actorId: 3, action: "journal_entry.create", amount: 500, evidenceIds: ["e1"], approvalIds: ["a1"] };

  test("exige une double approbation au-delà de 10000$", () => {
    const result = evaluateAccountingDecision({ ...base, amount: 15000, approvalIds: ["a1"] });
    expect(result.reasons).toContain("DOUBLE_APPROVAL_REQUIRED");
    const withTwo = evaluateAccountingDecision({ ...base, amount: 15000, approvalIds: ["a1", "a2"] });
    expect(withTwo.allowed).toBe(true);
  });

  test("refuse une écriture sur une période verrouillée sauf renversement", () => {
    const blocked = evaluateAccountingDecision({ ...base, periodLocked: true });
    expect(blocked.reasons).toContain("PERIOD_LOCKED");
    const reversal = evaluateAccountingDecision({ ...base, action: "journal_entry.reverse", periodLocked: true });
    expect(reversal.reasons).not.toContain("PERIOD_LOCKED");
  });

  test("refuse la séparation des tâches violée (préparateur = approbateur)", () => {
    const result = evaluateAccountingDecision({ ...base, actorIsPreparer: true, actorIsApprover: true });
    expect(result.reasons).toContain("DUTY_SEPARATION_VIOLATION");
  });
});

describe("inventoryGovernance.evaluateInventoryMovement", () => {
  const base = { organisationId: 1, actorId: 3, itemId: 5, action: "stock.adjust", quantity: 10, justification: "inventaire physique", evidenceIds: ["e1"], approvalIds: ["a1"] };

  test("autorise un ajustement complet et justifié", () => {
    expect(evaluateInventoryMovement(base).allowed).toBe(true);
  });

  test("interdit un mouvement vers une autre organisation", () => {
    const result = evaluateInventoryMovement({ ...base, destinationOrganisationId: 2 });
    expect(result.reasons).toContain("CROSS_ORGANISATION_MOVEMENT_FORBIDDEN");
  });

  test("exige une quantité positive", () => {
    expect(evaluateInventoryMovement({ ...base, quantity: 0 }).reasons).toContain("POSITIVE_QUANTITY_REQUIRED");
  });

  test("un transfert n'exige pas de preuve mais une perte en exige une", () => {
    const transfer = evaluateInventoryMovement({ organisationId: 1, actorId: 3, itemId: 5, action: "stock.transfer", quantity: 1, justification: "x" });
    expect(transfer.reasons).not.toContain("EVIDENCE_REQUIRED");
    const loss = evaluateInventoryMovement({ organisationId: 1, actorId: 3, itemId: 5, action: "stock.loss", quantity: 1, justification: "x" });
    expect(loss.reasons).toContain("EVIDENCE_REQUIRED");
  });
});

describe("supplierGovernance.evaluateSupplierDecision", () => {
  const base = { organisationId: 1, supplierId: 8, actorId: 3, action: "supplier.approve", criteria: ["quality"], riskLevel: "low", evidenceIds: ["e1"], approvalIds: ["a1"] };

  test("autorise une approbation complète", () => {
    expect(evaluateSupplierDecision(base).allowed).toBe(true);
  });

  test("exige une date de revue pour une action de revue", () => {
    const result = evaluateSupplierDecision({ ...base, action: "supplier.review", reviewDueAt: undefined });
    expect(result.reasons).toContain("REVIEW_DATE_REQUIRED");
  });

  test("exige des critères d'évaluation non vides", () => {
    expect(evaluateSupplierDecision({ ...base, criteria: [] }).reasons).toContain("CRITERIA_REQUIRED");
  });
});

describe("cognitiveAssistanceGovernance.evaluateCognitiveRecommendation", () => {
  const base = {
    organisationId: 1, recommendationId: "r1", contextSources: ["invoices"], policyIds: ["p1"],
    evidenceIds: ["e1"], confidence: 0.8, explanation: "basé sur l'historique", humanConfirmed: true,
  };

  test("exige une confirmation humaine par défaut", () => {
    const notConfirmed = evaluateCognitiveRecommendation({ ...base, humanConfirmed: false });
    expect(notConfirmed.executable).toBe(false);
    expect(notConfirmed.reasons).toContain("HUMAN_CONFIRMATION_REQUIRED");
  });

  test("reste toujours consultatif (advisoryOnly) même si exécutable", () => {
    expect(evaluateCognitiveRecommendation(base).advisoryOnly).toBe(true);
  });

  test("rejette une confiance hors [0,1]", () => {
    expect(evaluateCognitiveRecommendation({ ...base, confidence: 1.5 }).reasons).toContain("CONFIDENCE_OUT_OF_RANGE");
  });
});

describe("operationsGovernance.evaluateOperationalTransition", () => {
  test("autorise une transition séquentielle valide vers approval avec preuve", () => {
    const result = evaluateOperationalTransition({
      organisationId: 1, operationId: 1, type: "incident", currentState: "decision", nextState: "approval", evidenceIds: ["e1"],
    });
    expect(result.allowed).toBe(true);
  });

  test("refuse de sauter un état (decision -> execution directement)", () => {
    const result = evaluateOperationalTransition({ organisationId: 1, operationId: 1, type: "incident", currentState: "decision", nextState: "execution" });
    expect(result.reasons).toContain("INVALID_STATE_TRANSITION");
  });

  test("refuse la fermeture sans vérification passée", () => {
    const result = evaluateOperationalTransition({ organisationId: 1, operationId: 1, type: "incident", currentState: "verification", nextState: "closed", verificationPassed: false });
    expect(result.reasons).toContain("VERIFICATION_REQUIRED");
  });

  test("OPERATION_STATES est la séquence complète attendue", () => {
    expect(OPERATION_STATES[0]).toBe("observation");
    expect(OPERATION_STATES[OPERATION_STATES.length - 1]).toBe("closed");
  });
});

describe("financialDecisionGovernance.buildFinancialExplanation", () => {
  test("calcule le delta et la variation en pourcentage", () => {
    const result = buildFinancialExplanation({
      organisationId: 1, metric: "revenue", previousValue: 100, currentValue: 120,
      causes: ["nouveaux clients"], evidenceIds: ["e1"],
    });
    expect(result.valid).toBe(true);
    expect(result.explanation.delta).toBe(20);
    expect(result.explanation.variationPercent).toBe(20);
  });

  test("exige au moins une cause déclarée", () => {
    const result = buildFinancialExplanation({ organisationId: 1, metric: "revenue", previousValue: 100, currentValue: 120, evidenceIds: ["e1"] });
    expect(result.reasons).toContain("CAUSES_REQUIRED");
  });
});

describe("governedBusinessAction.createGovernedBusinessAction", () => {
  function buildHarness({ governanceAllowed = true } = {}) {
    const orchestrator = {
      evaluateGovernanceCommand: jest.fn(() => {
        if (!governanceAllowed) {
          const error = new Error("GOVERNANCE_EXECUTION_STOPPED");
          error.code = "GOVERNANCE_EXECUTION_STOPPED";
          throw error;
        }
        return { allowed: true };
      }),
    };
    return createGovernedBusinessAction({ orchestrator, repository: {}, integrityService: {} });
  }

  test("exige orchestrator/repository/integrityService à la construction", () => {
    expect(() => createGovernedBusinessAction({})).toThrow(TypeError);
  });

  test("refuse un domaine non pris en charge", async () => {
    const execute = buildHarness();
    await expect(execute({ domain: "unknown", perform: jest.fn() })).rejects.toMatchObject({ code: "GOVERNANCE_DOMAIN_UNSUPPORTED" });
  });

  test("refuse l'exécution si l'évaluateur du domaine refuse (sans jamais appeler perform)", async () => {
    const execute = buildHarness();
    const perform = jest.fn();
    await expect(execute({
      domain: "payroll",
      domainInput: { organisationId: 1, employeeId: 2, actorId: 3, action: "salary.change", justification: "x", policyId: 1, evidenceIds: [], approvalIds: [] },
      command: {}, resourceOrganisationId: 1, perform,
    })).rejects.toMatchObject({ code: "GOVERNANCE_DOMAIN_RULES_DENIED" });
    expect(perform).not.toHaveBeenCalled();
  });

  test("exécute perform() uniquement si domaine ET gouvernance autorisent", async () => {
    const execute = buildHarness();
    const perform = jest.fn().mockResolvedValue({ ok: true });
    const result = await execute({
      domain: "payroll",
      domainInput: { organisationId: 1, employeeId: 2, actorId: 3, action: "salary.change", justification: "x", policyId: 1, evidenceIds: ["e"], approvalIds: ["a"] },
      command: {}, resourceOrganisationId: 1, perform,
    });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(result.result).toEqual({ ok: true });
  });
});

describe("governedAdvisoryExecution.createGovernedAdvisoryExecution", () => {
  function harness() {
    const orchestrator = { evaluateGovernanceCommand: jest.fn(() => ({ allowed: true })) };
    return createGovernedAdvisoryExecution({ orchestrator });
  }

  test("exige orchestrator à la construction", () => {
    expect(() => createGovernedAdvisoryExecution({})).toThrow(TypeError);
  });

  test("executeRecommendation refuse sans confirmation humaine, sans jamais appeler perform", async () => {
    // humanConfirmationRequired vaut true par défaut : evaluateCognitiveRecommendation
    // marque déjà la recommandation non exécutable (HUMAN_CONFIRMATION_REQUIRED dans
    // reasons), donc c'est assertAllowed qui lève GOVERNANCE_RECOMMENDATION_DENIED —
    // le second garde-fou explicite de executeRecommendation ne sert que le cas
    // (rare) où humanConfirmationRequired serait désactivé sans confirmation réelle.
    const advisory = harness();
    const perform = jest.fn();
    await expect(advisory.executeRecommendation({
      recommendation: { organisationId: 1, recommendationId: "r1", contextSources: ["x"], policyIds: ["p"], evidenceIds: ["e"], confidence: 0.5, explanation: "x", humanConfirmed: false },
      command: {}, resourceOrganisationId: 1, context: {}, perform,
    })).rejects.toMatchObject({ code: "GOVERNANCE_RECOMMENDATION_DENIED" });
    expect(perform).not.toHaveBeenCalled();
  });

  test("executeRecommendation refuse même une recommandation valide si humanConfirmationRequired est désactivé sans confirmation", async () => {
    const advisory = harness();
    const perform = jest.fn();
    await expect(advisory.executeRecommendation({
      recommendation: {
        organisationId: 1, recommendationId: "r1", contextSources: ["x"], policyIds: ["p"], evidenceIds: ["e"],
        confidence: 0.5, explanation: "x", humanConfirmationRequired: false, humanConfirmed: false,
      },
      command: {}, resourceOrganisationId: 1, context: {}, perform,
    })).rejects.toMatchObject({ code: "GOVERNANCE_HUMAN_CONFIRMATION_REQUIRED" });
    expect(perform).not.toHaveBeenCalled();
  });

  test("executeRecommendation exécute perform() une fois confirmée humainement", async () => {
    const advisory = harness();
    const perform = jest.fn().mockResolvedValue("done");
    const result = await advisory.executeRecommendation({
      recommendation: { organisationId: 1, recommendationId: "r1", contextSources: ["x"], policyIds: ["p"], evidenceIds: ["e"], confidence: 0.5, explanation: "x", humanConfirmed: true },
      command: {}, resourceOrganisationId: 1, context: {}, perform,
    });
    expect(result.result).toBe("done");
  });

  test("executeOperationalTransition refuse une transition d'état invalide", async () => {
    const advisory = harness();
    await expect(advisory.executeOperationalTransition({
      transition: { organisationId: 1, operationId: 1, type: "incident", currentState: "decision", nextState: "execution" },
      command: {}, resourceOrganisationId: 1, context: {}, perform: jest.fn(),
    })).rejects.toMatchObject({ code: "GOVERNANCE_OPERATION_TRANSITION_DENIED" });
  });
});
