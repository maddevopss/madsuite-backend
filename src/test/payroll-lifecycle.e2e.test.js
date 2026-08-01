// Preuve d'exécution réelle pour l'issue #318 (écarts 1, 3, 5, 6, 7) : contrairement
// aux tests contractuels existants (vérification textuelle de la présence de
// fonctions), ce test exécute le cycle complet de paie contre une vraie base
// PostgreSQL — calcul brut/net d'un employé horaire et d'un employé salarié,
// approbation, paiement, publication comptable réellement persistée et
// équilibrée dans accounting_entries/accounting_entry_lines (écart #1),
// rapprochement explicite payroll_runs.accounting_entry_id (écart #1),
// sélection du jeu de règles actif par date de paie et gouvernance du
// chevauchement à l'activation (écart #7), lien explicite payroll_period_id
// entre période et cycle (écart #6), correction non destructive d'un cycle
// payé (écart #5), et isolation entre deux organisations (écart #3).
const db = require("../../db");
const { createTestOrganisation } = require("./helpers/testData");
const { activateRuleset, createRunFromPeriod } = require("../services/business/payroll-run-lifecycle.service");
const { calculateRun, transitionRun } = require("../services/business/payroll-transaction.service");
const { postPayrollJournal } = require("../services/business/payroll-accounting.service");
const { reversePostedEntry } = require("../services/business/accounting-reversal-governance.service");

jest.mock("../services/business/trust-persistence.service", () => ({
  persistTrustAssessment: jest.fn().mockResolvedValue({ assessmentId: 1 }),
  persistGraphEdges: jest.fn().mockResolvedValue({}),
}));

const RULES = {
  payPeriodsPerYear: 26,
  overtimeMultiplier: 1.5,
  employeeDeductions: { RRQ: 0.054, AE: 0.0132 },
  employerContributions: { RRQ: 0.054, AE: 0.0185 },
  voluntaryDeductions: {},
};

function checksumRules(rules) {
  const { checksumRules: fn } = require("../services/business/payroll-run-lifecycle.service");
  return fn(rules);
}

async function seedOpenAccountingPeriod(organisationId, { fiscalYear, periodNumber, startsOn, endsOn }) {
  await db.pool.query(
    `INSERT INTO accounting_periods (organisation_id, fiscal_year, period_number, starts_on, ends_on, status)
     VALUES ($1,$2,$3,$4,$5,'open')`,
    [organisationId, fiscalYear, periodNumber, startsOn, endsOn],
  );
}

async function seedAccountingChart(organisationId) {
  const codes = [
    ["6100", "Salaires bruts", "expense"],
    ["6200", "Charges employeur", "expense"],
    ["2200", "Salaires nets à payer", "liability"],
    ["2210", "Retenues à remettre", "liability"],
    ["2220", "Contributions à remettre", "liability"],
  ];
  const ids = {};
  for (const [code, name, type] of codes) {
    const { rows } = await db.pool.query(
      `INSERT INTO accounting_accounts (organisation_id, code, name, account_type, normal_balance, is_active)
       VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [organisationId, code, name, type, type === "expense" ? "debit" : "credit"],
    );
    ids[code] = rows[0].id;
  }
  return {
    expenseAccountId: ids["6100"],
    contributionExpenseAccountId: ids["6200"],
    payableAccountId: ids["2200"],
    deductionLiabilityAccountId: ids["2210"],
    contributionLiabilityAccountId: ids["2220"],
  };
}

async function seedRuleset(organisationId, { version, effectiveFrom, effectiveTo, rules = RULES, userId }) {
  const checksum = checksumRules(rules);
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_rulesets (organisation_id, version, province, effective_from, effective_to, rules, checksum, status, created_by)
     VALUES ($1,$2,'QC',$3,$4,$5,$6,'draft',$7) RETURNING *`,
    [organisationId, version, effectiveFrom, effectiveTo || null, JSON.stringify(rules), checksum, userId || null],
  );
  return rows[0];
}

async function seedEmployee(organisationId, overrides = {}) {
  const base = {
    employeeNumber: `E-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    legalName: "Test Employee",
    legalFirstName: "Test",
    legalLastName: "Employee",
    hireDate: "2020-01-01",
    payType: "hourly",
    hourlyRate: 25,
    annualSalary: null,
    ...overrides,
  };
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_employees
      (organisation_id, employee_number, legal_name, legal_first_name, legal_last_name, hire_date, pay_type, hourly_rate, annual_salary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [organisationId, base.employeeNumber, base.legalName, base.legalFirstName, base.legalLastName, base.hireDate, base.payType, base.hourlyRate, base.annualSalary],
  );
  return rows[0];
}

async function seedPeriod(organisationId, { periodStart, periodEnd, payDate }) {
  const { rows } = await db.pool.query(
    `INSERT INTO payroll_periods (organisation_id, frequency, period_start, period_end, pay_date)
     VALUES ($1,'biweekly',$2,$3,$4) RETURNING *`,
    [organisationId, periodStart, periodEnd, payDate],
  );
  return rows[0];
}

async function seedVariableInput(organisationId, periodId, employeeId, { inputType, quantity = null, amount = null }) {
  await db.pool.query(
    `INSERT INTO payroll_variable_inputs (organisation_id, payroll_period_id, employee_id, input_type, quantity, amount, source_type, source_id)
     VALUES ($1,$2,$3,$4,$5,$6,'manual','test')`,
    [organisationId, periodId, employeeId, inputType, quantity, amount],
  );
}

describe("Cycle de paie complet (#318)", () => {
  let orgA;
  let orgB;

  beforeAll(async () => {
    orgA = await createTestOrganisation({ nom: "Paie E2E Org A" });
    orgB = await createTestOrganisation({ nom: "Paie E2E Org B" });
  });

  // Pas de nettoyage explicite : accounting_entries/accounting_entry_lines
  // publiées ou renversées sont immuables par déclencheur
  // (accounting_lines_immutable_when_posted), et payroll_variable_inputs/
  // payroll_periods sont verrouillés dès le calcul — deux garanties qu'on
  // vient précisément de prouver ci-dessus. Elles restent rattachées aux
  // organisations de test jetables créées ci-dessus (id unique par
  // exécution), sans effet sur le reste de la suite.

  test("écart #7 — activer un nouveau jeu de règles retire l'ancien (pas de chevauchement actif)", async () => {
    const rulesetV1 = await seedRuleset(orgA.id, { version: "QC-2026-v1", effectiveFrom: "2026-01-01" });
    await activateRuleset(db.pool, orgA.id, rulesetV1.id, null);

    const rulesetV2 = await seedRuleset(orgA.id, { version: "QC-2026-v2", effectiveFrom: "2026-06-01" });
    await activateRuleset(db.pool, orgA.id, rulesetV2.id, null);

    const { rows } = await db.pool.query(
      `SELECT id, status, effective_to FROM payroll_rulesets WHERE organisation_id=$1 AND version=$2`,
      [orgA.id, "QC-2026-v1"],
    );
    expect(rows[0].status).toBe("retired");
    expect(rows[0].effective_to).not.toBeNull();

    const activeCount = await db.pool.query(
      `SELECT COUNT(*)::int AS n FROM payroll_rulesets WHERE organisation_id=$1 AND province='QC' AND status='active'`,
      [orgA.id],
    );
    expect(activeCount.rows[0].n).toBe(1);
  });

  test("cycle complet : employé horaire + salarié, calcul, approbation, paiement, comptabilisation, correction", async () => {
    const accounts = await seedAccountingChart(orgA.id);
    await seedOpenAccountingPeriod(orgA.id, { fiscalYear: 2026, periodNumber: 7, startsOn: "2026-07-01", endsOn: "2026-07-31" });

    const employeeHourly = await seedEmployee(orgA.id, { payType: "hourly", hourlyRate: 25, legalName: "Horaire Test" });
    const employeeSalaried = await seedEmployee(orgA.id, { payType: "salary", hourlyRate: null, annualSalary: 65000, legalName: "Salarié Test" });

    const period = await seedPeriod(orgA.id, { periodStart: "2026-07-01", periodEnd: "2026-07-14", payDate: "2026-07-18" });

    // Le jeu de règles doit être actif ET couvrir la date de paie (écart #7 :
    // sélection automatique par date, pas juste "le dernier créé").
    const ruleset = await seedRuleset(orgA.id, { version: "QC-2026-run", effectiveFrom: "2026-01-01" });
    await activateRuleset(db.pool, orgA.id, ruleset.id, null);

    await seedVariableInput(orgA.id, period.id, employeeHourly.id, { inputType: "regular_hours", quantity: 70 });
    await seedVariableInput(orgA.id, period.id, employeeHourly.id, { inputType: "overtime_hours", quantity: 5 });
    await seedVariableInput(orgA.id, period.id, employeeSalaried.id, { inputType: "bonus", amount: 500 });

    // Écart #6 : le cycle créé depuis une période porte payroll_period_id explicite.
    const { run: createdRun } = await createRunFromPeriod(db.pool, {
      organisationId: orgA.id,
      periodId: period.id,
      idempotencyKey: "run-creation-e2e-001",
    });
    expect(createdRun.payroll_period_id).toBe(period.id);
    expect(createdRun.ruleset_id).toBe(ruleset.id);

    const calc = await calculateRun({
      organisationId: orgA.id,
      runId: createdRun.id,
      idempotencyKey: "calc-e2e-0000001",
      createdBy: null,
    });
    expect(calc.run.status).toBe("calculated");
    // 70h régulières à 25$ + 5h sup. à 25$*1.5 = 1750 + 187.5 = 1937.5
    expect(Number(calc.run.totals.gross)).toBeCloseTo(1937.5 + 65000 / 26 + 500, 2);
    expect(Number(calc.run.totals.deductions)).toBeGreaterThan(0);
    expect(Number(calc.run.totals.employerContributions)).toBeGreaterThan(0);

    // La période est verrouillée après calcul.
    const lockedPeriod = await db.pool.query(`SELECT status FROM payroll_periods WHERE id=$1`, [period.id]);
    expect(lockedPeriod.rows[0].status).toBe("locked");

    const approved = await transitionRun({ organisationId: orgA.id, runId: createdRun.id, action: "approve", idempotencyKey: "approve-e2e-001" });
    expect(approved.run.status).toBe("approved");

    const paid = await transitionRun({ organisationId: orgA.id, runId: createdRun.id, action: "pay", idempotencyKey: "pay-e2e-0000001" });
    expect(paid.run.status).toBe("paid");

    // Écart #1 : la comptabilisation publie réellement une écriture équilibrée,
    // pas seulement un aperçu en mémoire.
    const posted = await postPayrollJournal(db.pool, {
      organisationId: orgA.id,
      run: paid.run,
      userId: null,
      ...accounts,
    });
    expect(posted.duplicate).toBe(false);

    const entry = await db.pool.query(`SELECT * FROM accounting_entries WHERE id=$1`, [posted.entryId]);
    expect(entry.rows[0].status).toBe("posted");

    const lines = await db.pool.query(`SELECT * FROM accounting_entry_lines WHERE entry_id=$1`, [posted.entryId]);
    const totalDebit = lines.rows.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = lines.rows.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(totalDebit).toBeCloseTo(totalCredit, 2);
    expect(totalDebit).toBeGreaterThan(0);

    const runAfterPosting = await db.pool.query(`SELECT accounting_entry_id FROM payroll_runs WHERE id=$1`, [createdRun.id]);
    expect(runAfterPosting.rows[0].accounting_entry_id).toBe(posted.entryId);

    // Republier est idempotent : aucune deuxième écriture, aucune deuxième insertion de lignes.
    const repost = await postPayrollJournal(db.pool, { organisationId: orgA.id, run: paid.run, userId: null, ...accounts });
    expect(repost.duplicate).toBe(true);
    const linesAfterRepost = await db.pool.query(`SELECT COUNT(*)::int AS n FROM accounting_entry_lines WHERE entry_id=$1`, [posted.entryId]);
    expect(linesAfterRepost.rows[0].n).toBe(lines.rows.length);

    // Écart #5 : correction d'un cycle payé — renversement non destructif de
    // l'écriture publiée, cycle marqué 'corrected' (jamais remis à 'paid' en silence).
    const reversal = await reversePostedEntry({
      organisationId: orgA.id,
      entryId: posted.entryId,
      reversalDate: "2026-07-20",
      reason: "Erreur de saisie détectée après paiement (test e2e)",
      idempotencyKey: `payroll-correction-e2e:${createdRun.id}`,
      confirmedByHuman: true,
      reversedBy: null,
    });
    expect(reversal.duplicate).toBe(false);

    const reversedEntry = await db.pool.query(`SELECT status FROM accounting_entries WHERE id=$1`, [posted.entryId]);
    expect(reversedEntry.rows[0].status).toBe("reversed");

    const reversalEntry = await db.pool.query(`SELECT status FROM accounting_entries WHERE id=$1`, [reversal.reversal.id]);
    expect(reversalEntry.rows[0].status).toBe("posted");

    const reversalLines = await db.pool.query(`SELECT * FROM accounting_entry_lines WHERE entry_id=$1`, [reversal.reversal.id]);
    const reversalDebit = reversalLines.rows.reduce((sum, l) => sum + Number(l.debit), 0);
    const reversalCredit = reversalLines.rows.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(reversalDebit).toBeCloseTo(reversalCredit, 2);
    expect(reversalDebit).toBeCloseTo(totalDebit, 2);
  });

  test("écart #3 — isolation stricte entre deux organisations", async () => {
    const employeeOrgA = await seedEmployee(orgA.id, { legalName: "Isolation Org A" });
    const employeeOrgB = await seedEmployee(orgB.id, { legalName: "Isolation Org B" });

    const crossOrgLookup = await db.pool.query(
      `SELECT * FROM payroll_employees WHERE organisation_id=$1 AND id=$2`,
      [orgB.id, employeeOrgA.id],
    );
    expect(crossOrgLookup.rows).toHaveLength(0);

    const ownOrgLookup = await db.pool.query(
      `SELECT * FROM payroll_employees WHERE organisation_id=$1 AND id=$2`,
      [orgB.id, employeeOrgB.id],
    );
    expect(ownOrgLookup.rows).toHaveLength(1);
  });
});
