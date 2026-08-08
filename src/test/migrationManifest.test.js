const { getManifestMigrations, auditPendingMigrations } = require("../migrate/migrationManifest");

describe("migration manifest", () => {
  test("déclare une chaîne ordonnée et vérifie les fichiers présents", () => {
    const migrations = getManifestMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(new Set(migrations.map(({ file }) => file)).size).toBe(migrations.length);
  });

  test("exclut explicitement les anciennes copies divergentes", () => {
    const migrations = getManifestMigrations();
    for (const file of [
      "027_add_last_sync_at.sql",
      "029_clarify_utilisateurs_fk.sql",
      "033_stripe_subscriptions.sql",
    ]) {
      const entry = migrations.find((migration) => migration.file === file);
      expect(entry?.relativePath).toBe(`archive/migrations/${file}`);
    }
  });

  test("signale les DDL et contrôles transactionnels incompatibles avant exécution", () => {
    const violations = auditPendingMigrations(getManifestMigrations(), new Set());

    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: "20260727182000_accounting_budgets_cost_centers.sql",
          rule: expect.stringContaining("ADD CONSTRAINT IF NOT EXISTS"),
        }),
        expect.objectContaining({
          file: "028_partition_security_buffer.sql",
          rule: expect.stringContaining("ALLOW_LEGACY_SELF_MANAGED_MIGRATIONS"),
        }),
      ]),
    );
  });
});
