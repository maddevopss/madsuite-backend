const crypto = require("crypto");
const { validateRulesetForActivation, createRunFromPeriod } = require("../services/business/payroll-run-lifecycle.service");

test("refuse un jeu de règles dont l’empreinte ne correspond pas", () => {
  expect(() => validateRulesetForActivation({
    version: "2026.1",
    province: "QC",
    effective_from: "2026-01-01",
    rules: { example: true },
    checksum: "incorrect",
  })).toThrow("empreinte");
});

test("accepte un jeu de règles complet et intact", () => {
  const rules = { employeeDeductions: [], employerContributions: [] };
  expect(() => validateRulesetForActivation({
    version: "2026.1",
    province: "QC",
    effective_from: "2026-01-01",
    rules,
    checksum: crypto.createHash("sha256").update(JSON.stringify(rules)).digest("hex"),
  })).not.toThrow();
});

test("retourne le cycle existant pour la même clé d’idempotence", async () => {
  const run = { id: 9, creation_idempotency_key: "create-run-9" };
  const db = { query: jest.fn()
    .mockResolvedValueOnce({ rows: [{ id: 3, pay_date: "2026-01-16" }] })
    .mockResolvedValueOnce({ rows: [run] }) };

  await expect(createRunFromPeriod(db, {
    organisationId: 1,
    periodId: 3,
    idempotencyKey: "create-run-9",
  })).resolves.toEqual({ duplicate: true, run });
});
