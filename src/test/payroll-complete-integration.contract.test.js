const fs = require("fs");
const path = require("path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "../..", relativePath), "utf8");
}
describe("Bloc paie #318 - intégration réelle", () => {
  test("les migrations couvrent employés, historique, périodes, entrées et isolation", () => {
    const employees = read("db/migrations/071_payroll_employee_foundation.sql");
    const inputs = read("db/migrations/072_payroll_periods_inputs.sql");
    expect(employees).toContain("payroll_compensation_history");
    expect(employees).toContain("ENABLE ROW LEVEL SECURITY");
    expect(inputs).toContain("payroll_periods");
    expect(inputs).toContain("payroll_variable_inputs");
    expect(inputs).toContain("prevent_locked_payroll_input_change");
  });

  test("les routes exposent les opérations de production", () => {
    const routes = read("src/routes/business/payroll.routes.js");
    for (const contract of [
      'router.patch("/employees/:id"',
      'router.get("/periods"',
      'router.post("/periods"',
      'router.get("/periods/:id/inputs"',
      'router.post("/periods/:id/inputs"',
      'router.get("/runs/:id/pay-stubs"',
      'router.get("/runs/:id/register"',
      'router.post("/runs/:id/accounting-preview"',
    ]) expect(routes).toContain(contract);
    expect(routes).toContain("organisation_id=$1");
    expect(routes).toContain("payroll_compensation_history");
  });

  test("le moteur transactionnel utilise les calculs détaillés et verrouille la période", () => {
    const service = read("src/services/business/payroll-transaction.service.js");
    expect(service).toContain("calculateGrossPay");
    expect(service).toContain("calculateNetPay");
    expect(service).toContain("payroll_variable_inputs");
    expect(service).toContain("payroll_periods SET status='locked'");
    expect(service).toContain("payroll.inputs_locked");
  });

  test("la comptabilisation, les documents et la fermeture sont reliés", () => {
    expect(read("src/routes/business/payroll.routes.js")).toContain("buildPayrollJournal");
    expect(read("src/routes/business/payroll.routes.js")).toContain("buildPayStub");
    expect(read("src/routes/business/payroll.routes.js")).toContain("buildPayrollRegister");
    expect(read("src/services/business/payroll-accounting.service.js")).toContain("idempotencyKey");
    expect(read("src/services/business/payroll-documents.service.js")).toContain("documentHash");
  });
});
