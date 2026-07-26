const fs = require("fs");
const path = require("path");

function readMigration(name) {
  return fs.readFileSync(path.join(__dirname, "../../db/migrations", name), "utf8");
}

describe("Bloc 1 / Sprint 1 — fondation comptable", () => {
  test("le schéma protège les comptes et périodes par organisation", () => {
    const migration = readMigration("059_accounting_phase_b.sql");

    expect(migration).toContain("UNIQUE (organisation_id, code)");
    expect(migration).toContain("accounting_periods");
    expect(migration).toContain("status IN ('open','closed','locked')");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("app.current_organisation_id");
  });

  test("le plan comptable couvre les cinq familles fondamentales", () => {
    const service = fs.readFileSync(
      path.join(__dirname, "../services/business/accounting.service.js"),
      "utf8",
    );

    for (const type of ["asset", "liability", "equity", "revenue", "expense"]) {
      expect(service).toContain(`"${type}"`);
    }
  });

  test("les comptes système et les périodes fermées sont gouvernés", () => {
    const migration = readMigration("070_accounting_periods_explainability.sql");

    expect(migration).toMatch(/period/i);
    expect(migration).toMatch(/closed/i);
    expect(migration).toMatch(/organisation_id/i);
  });
});
