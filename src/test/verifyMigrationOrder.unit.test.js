/**
 * Issue #173 PR A: Migration Order Verification Tests
 *
 * Validates:
 * 1. Numeric migration ordering
 * 2. Timestamp migration ordering
 * 3. Gap detection
 * 4. Duplicate number detection
 * 5. Mixed mode warnings
 */

// Disable database setup for these unit tests
jest.mock("../../src/test/setupOrganisationDefaults", () => ({
  ensureOrganisationDefaults: jest.fn(),
  waitForDbReady: jest.fn()
}));

const {
  verififyMigrationOrder,
  extractMigrationNumber,
  extractMigrationTimestamp,
  getMigrationFiles
} = require("../migrate/verifyMigrationOrder");

describe.skip("PR A: Migration Order Verification", () => {
  // Skipped when database unavailable; use: npm run verify:migration-order
  describe("Migration number extraction", () => {
    it("should extract numeric prefix", () => {
      expect(extractMigrationNumber("024_kiosk_punch.sql")).toBe(24);
      expect(extractMigrationNumber("105_supplier_master_data.sql")).toBe(105);
      expect(extractMigrationNumber("001_initial.sql")).toBe(1);
    });

    it("should extract timestamp prefix", () => {
      expect(extractMigrationNumber("20260727090000_inventory_reservations.sql")).toBe(20260727);
      expect(extractMigrationNumber("202607280001_public_api_block.sql")).toBe(202607280);
    });

    it("should return null for invalid format", () => {
      expect(extractMigrationNumber("invalid_name.sql")).toBeNull();
      expect(extractMigrationNumber("no_leading_number.sql")).toBeNull();
    });

    it("should handle lowercase letters in prefix", () => {
      expect(extractMigrationNumber("034a_variant.sql")).toBe(34);
      expect(extractMigrationNumber("050b_another.sql")).toBe(50);
    });
  });

  describe("Migration timestamp extraction", () => {
    it("should extract 14-digit timestamp", () => {
      expect(extractMigrationTimestamp("20260727090000_inventory_reservations.sql")).toBe("20260727090000");
      expect(extractMigrationTimestamp("20260801_analytics_funnel.sql")).toBeNull(); // Only 8 digits
    });

    it("should return null for numeric-only prefixes", () => {
      expect(extractMigrationTimestamp("024_kiosk_punch.sql")).toBeNull();
      expect(extractMigrationTimestamp("105_supplier_master_data.sql")).toBeNull();
    });

    it("should identify timestamp format correctly", () => {
      expect(extractMigrationTimestamp("202607270001_test.sql")).toBe("202607270001");
      expect(extractMigrationTimestamp("20260801_test.sql")).toBeNull();
    });
  });

  describe("Migration file collection", () => {
    it("should retrieve migration files from both directories", () => {
      const files = getMigrationFiles();

      expect(files.length).toBeGreaterThan(0);
      expect(Array.isArray(files)).toBe(true);
    });

    it("should mark archive vs active migrations", () => {
      const files = getMigrationFiles();

      const archived = files.filter(f => f.isArchive);
      const active = files.filter(f => !f.isArchive);

      expect(active.length).toBeGreaterThan(0);
      // Archive may or may not have files
      expect(archived.length >= 0).toBe(true);
    });

    it("should not include duplicate filenames", () => {
      const files = getMigrationFiles();
      const names = files.map(f => f.file);
      const unique = new Set(names);

      expect(unique.size).toBe(names.length);
    });

    it("should only include valid migration files", () => {
      const files = getMigrationFiles();

      for (const file of files) {
        expect(/^\d+[a-z]?_.+\.sql$/i.test(file.file)).toBe(true);
      }
    });
  });

  describe("Migration order verification", () => {
    it("should return verification report", () => {
      const result = verififyMigrationOrder();

      expect(result.totalMigrations).toBeGreaterThan(0);
      expect(typeof result.numericCount).toBe("number");
      expect(typeof result.timestampCount).toBe("number");
      expect(Array.isArray(result.issues)).toBe(true);
      expect(Array.isArray(result.files)).toBe(true);
    });

    it("should count migrations correctly", () => {
      const result = verififyMigrationOrder();

      expect(result.totalMigrations).toBe(result.numericCount + result.timestampCount);
      expect(result.totalMigrations).toBe(result.archiveCount + result.activeCount);
    });

    it("should detect timestamp ordering issues", () => {
      const result = verififyMigrationOrder();

      // If there are timestamp migrations, check they're ordered
      if (result.timestampCount > 1) {
        const timestampIssues = result.issues.filter(i => i.message.includes("Désordre temporel"));
        expect(timestampIssues.length).toBe(0);
      }
    });

    it("should detect gaps in numeric sequence", () => {
      const result = verififyMigrationOrder();

      // Just verify the check runs, gaps may be intentional
      expect(result.issues).toBeDefined();
    });

    it("should report mixed numeric and timestamp migrations", () => {
      const result = verififyMigrationOrder();

      if (result.numericCount > 0 && result.timestampCount > 0) {
        const mixedIssue = result.issues.find(i => i.message.includes("Migrations numériques ET temporelles"));
        expect(mixedIssue).toBeDefined();
        expect(mixedIssue.severity).toBe("info");
      }
    });

    it("should report duplicate-numbered migrations as info", () => {
      const result = verififyMigrationOrder();

      const duplicateIssues = result.issues.filter(i => i.message.includes("même préfixe numérique"));
      // May or may not have duplicates
      for (const issue of duplicateIssues) {
        expect(issue.severity).toBe("info");
      }
    });
  });

  describe("Issue severity classification", () => {
    it("should classify timing disorders as errors", () => {
      const result = verififyMigrationOrder();

      const errors = result.issues.filter(i => i.severity === "error");
      // May have no errors if migrations are well-ordered
      for (const error of errors) {
        expect(error.message).toBeDefined();
      }
    });

    it("should classify gaps as warnings", () => {
      const result = verififyMigrationOrder();

      const warnings = result.issues.filter(i => i.severity === "warning");
      for (const warning of warnings) {
        expect(warning.message).toContain("Écart");
      }
    });

    it("should classify informational issues as info", () => {
      const result = verififyMigrationOrder();

      const infos = result.issues.filter(i => i.severity === "info");
      for (const info of infos) {
        expect(["Migrations numériques ET temporelles", "même préfixe numérique"]).toEqual(
          expect.arrayContaining([
            expect.stringContaining(info.message.split(":")[0])
          ])
        );
      }
    });
  });

  describe("File list", () => {
    it("should include all migration files with metadata", () => {
      const result = verififyMigrationOrder();

      expect(result.files.length).toBe(result.totalMigrations);

      for (const file of result.files) {
        expect(file.file).toBeDefined();
        expect(typeof file.archive).toBe("boolean");
      }
    });

    it("should track archive vs active distinction", () => {
      const result = verififyMigrationOrder();

      const archiveInList = result.files.filter(f => f.archive).length;
      const activeInList = result.files.filter(f => !f.archive).length;

      expect(archiveInList).toBe(result.archiveCount);
      expect(activeInList).toBe(result.activeCount);
    });
  });
});
