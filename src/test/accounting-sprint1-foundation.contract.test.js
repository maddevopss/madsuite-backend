const fs = require("fs");
const path = require("path");

function readMigration(name) {
  return fs.readFileSync(path.join(__dirname, "../../db/migrations", name), "utf8");
}

describe("Bloc 1 / Sprint 1 — fondation comptable", () => {
  test("le schéma protège les comptes et périodes par organisation", () => {
    const coreMigration = readMigration("058_core_business_modules.sql");
    const periodMigration = readMigration("059_accounting_phase_b.sql");

    expect(coreMigration).toContain("UNIQUE (organisation_id, code)");
    expect(periodMigration).toContain("accounting_periods");
    expect(periodMigration).toContain("status IN ('open','closed','locked')");
    expect(periodMigration).toContain("ALTER TABLE accounting_periods ENABLE ROW LEVEL SECURITY");
    expect(periodMigration).toContain("app.current_organisation_id");
  });

  test("le plan comptable couvre les cinq familles fondamentales", () => {
    const coreMigration = readMigration("058_core_business_modules.sql");

    for (const type of ["asset", "liability", "equity", "revenue", "expense"]) {
      expect(coreMigration).toContain(`'${type}'`);
    }
  });

  test("les comptes système et les périodes fermées sont gouvernés", () => {
    const migration = readMigration("070_accounting_periods_explainability.sql");

    expect(migration).toMatch(/period/i);
    expect(migration).toMatch(/closed/i);
    expect(migration).toMatch(/organisation_id/i);
  });
});
