const fs = require("fs");
const path = require("path");

const servicePath = path.resolve(
  __dirname,
  "../services/invoice/invoice-ledger.service.js",
);
const source = fs.readFileSync(servicePath, "utf8");

describe("Ledger financier — contrat append-only P0", () => {
  test("le service n'expose qu'une écriture par insertion", () => {
    expect(source).toContain("INSERT INTO ledger_entries");
    expect(source).not.toMatch(/UPDATE\s+ledger_entries/i);
    expect(source).not.toMatch(/DELETE\s+FROM\s+ledger_entries/i);
  });

  test("les tentatives de mutation explicite sont rejetées", () => {
    expect(source).toContain("append_only_ledger");
    expect(source).toContain("Ledger entries cannot be updated");
    expect(source).toContain("extraArgs.id !== undefined");
    expect(source).toContain("extraArgs.updated_at !== undefined");
  });

  test("la référence externe et l'organisation sont toujours persistées", () => {
    expect(source).toContain("organisation_id");
    expect(source).toContain("reference_type");
    expect(source).toContain("reference_id");
    expect(source).toContain("organisationValue(organisationId)");
  });
});
