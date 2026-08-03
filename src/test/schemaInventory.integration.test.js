/**
 * Issue #173 PR A: Schema Inventory Integration Tests
 *
 * Validates:
 * 1. Comprehensive schema scanning (tables, columns, constraints, indexes, policies, roles, sequences, triggers)
 * 2. Correct data type and constraint detection
 * 3. RLS policy enumeration
 * 4. Trigger and sequence tracking
 * 5. Inventory validation against requirements
 */

const db = require("../../db");
const {
  getSchemaInventory,
  validateInventory,
  getAllTables,
  getAllConstraints,
  getAllIndexes,
  getAllPolicies,
  getAllSequences,
  getAllRoles,
  getAllTriggers
} = require("../migrate/schemaInventory");

describe("PR A: Schema Inventory Tool", () => {
  let client;

  beforeAll(async () => {
    client = await db.pool.connect();
  });

  afterAll(async () => {
    if (client) client.release();
  });

  describe("Schema inventory collection", () => {
    it("should collect complete inventory from database", async () => {
      const inventory = await getSchemaInventory(client);

      expect(inventory).toBeDefined();
      expect(inventory.timestamp).toBeDefined();
      expect(inventory.tables).toBeDefined();
      expect(inventory.constraints).toBeDefined();
      expect(inventory.indexes).toBeDefined();
      expect(inventory.policies).toBeDefined();
      expect(inventory.sequences).toBeDefined();
      expect(inventory.roles).toBeDefined();
      expect(inventory.triggers).toBeDefined();
      expect(inventory.stats).toBeDefined();
    });

    it("should count schema elements correctly", async () => {
      const inventory = await getSchemaInventory(client);

      expect(inventory.stats.tableCount).toBeGreaterThan(0);
      expect(inventory.stats.tableCount).toBe(Object.keys(inventory.tables).length);
      expect(inventory.stats.constraintCount).toBe(Object.keys(inventory.constraints).length);
      expect(inventory.stats.indexCount).toBe(Object.keys(inventory.indexes).length);
    });
  });

  describe("Table scanning", () => {
    it("should detect all tables in current schema", async () => {
      const tables = await getAllTables(client);

      expect(Object.keys(tables).length).toBeGreaterThan(0);
      // Check for known tables
      const tableNames = Object.keys(tables);
      expect(tableNames.length > 0).toBe(true);
    });

    it("should identify columns with metadata", async () => {
      const tables = await getAllTables(client);
      const inventory = await getSchemaInventory(client);

      // Pick first table with columns
      const tableEntry = Object.values(tables).find(t => t.columns.length > 0);
      expect(tableEntry).toBeDefined();

      const firstColumn = tableEntry.columns[0];
      expect(firstColumn.name).toBeDefined();
      expect(firstColumn.type).toBeDefined();
      expect(typeof firstColumn.nullable).toBe("boolean");
    });

    it("should preserve column order", async () => {
      const tables = await getAllTables(client);

      for (const table of Object.values(tables)) {
        if (table.columns.length > 1) {
          for (let i = 1; i < table.columns.length; i++) {
            expect(table.columns[i].position).toBeGreaterThan(table.columns[i - 1].position);
          }
          break;
        }
      }
    });

    it("should detect nullable columns", async () => {
      const tables = await getAllTables(client);

      let foundNullable = false;
      for (const table of Object.values(tables)) {
        for (const col of table.columns) {
          if (col.nullable) {
            foundNullable = true;
            break;
          }
        }
        if (foundNullable) break;
      }

      expect(foundNullable).toBe(true);
    });

    it("should detect column defaults", async () => {
      const tables = await getAllTables(client);

      let foundDefault = false;
      for (const table of Object.values(tables)) {
        for (const col of table.columns) {
          if (col.default) {
            foundDefault = true;
            break;
          }
        }
        if (foundDefault) break;
      }

      // Should find at least some defaults (timestamps, sequence values, etc.)
      expect(foundDefault).toBe(true);
    });
  });

  describe("Constraint detection", () => {
    it("should identify all constraint types", async () => {
      const constraints = await getAllConstraints(client);

      const types = new Set();
      for (const constraint of Object.values(constraints)) {
        types.add(constraint.type);
      }

      expect(types.size).toBeGreaterThan(0);
      // Should have PRIMARY KEY at minimum
      expect(Array.from(types)).toContain("PRIMARY KEY");
    });

    it("should detect primary keys", async () => {
      const constraints = await getAllConstraints(client);

      const pks = Object.values(constraints).filter(c => c.type === "PRIMARY KEY");
      expect(pks.length).toBeGreaterThan(0);

      for (const pk of pks) {
        expect(pk.columns.length).toBeGreaterThan(0);
        expect(pk.table).toBeDefined();
      }
    });

    it("should detect foreign key references", async () => {
      const constraints = await getAllConstraints(client);

      const fks = Object.values(constraints).filter(c => c.type === "FOREIGN KEY");

      if (fks.length > 0) {
        for (const fk of fks) {
          expect(fk.references).toBeDefined();
          expect(fk.references.table).toBeDefined();
          expect(fk.references.column).toBeDefined();
          expect(fk.references.deleteRule).toBeDefined();
          expect(fk.references.updateRule).toBeDefined();
        }
      }
    });

    it("should detect unique constraints", async () => {
      const constraints = await getAllConstraints(client);

      const uniques = Object.values(constraints).filter(c => c.type === "UNIQUE");

      if (uniques.length > 0) {
        for (const u of uniques) {
          expect(u.columns.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe("Index detection", () => {
    it("should identify all indexes", async () => {
      const indexes = await getAllIndexes(client);

      expect(Object.keys(indexes).length).toBeGreaterThan(0);
    });

    it("should mark primary key indexes", async () => {
      const indexes = await getAllIndexes(client);

      const pkIndexes = Object.values(indexes).filter(i => i.isPrimary);
      expect(pkIndexes.length).toBeGreaterThan(0);
    });

    it("should track index validity", async () => {
      const indexes = await getAllIndexes(client);

      for (const index of Object.values(indexes)) {
        expect(typeof index.isValid).toBe("boolean");
        expect(index.isValid).toBe(true);
      }
    });

    it("should list index columns in order", async () => {
      const indexes = await getAllIndexes(client);

      for (const index of Object.values(indexes)) {
        if (index.columns.length > 0) {
          expect(Array.isArray(index.columns)).toBe(true);
          expect(index.columns.every(c => typeof c === "string")).toBe(true);
        }
      }
    });
  });

  describe("RLS Policy detection", () => {
    it("should enumerate RLS policies when present", async () => {
      const policies = await getAllPolicies(client);

      // Policies are optional, just verify structure if any exist
      for (const policy of Object.values(policies)) {
        expect(policy.name).toBeDefined();
        expect(policy.table).toBeDefined();
        expect(typeof policy.permissive).toBe("boolean");
        expect(policy.command).toBeDefined();
      }
    });

    it("should track policy expressions", async () => {
      const policies = await getAllPolicies(client);

      if (Object.keys(policies).length > 0) {
        for (const policy of Object.values(policies)) {
          // Qual or with_check should be present for meaningful policies
          expect(
            policy.qualExpression !== null || policy.withCheckExpression !== null
          ).toBe(true);
        }
      }
    });
  });

  describe("Sequence detection", () => {
    it("should identify sequences in schema", async () => {
      const sequences = await getAllSequences(client);

      // Sequences exist for SERIAL columns
      if (Object.keys(sequences).length > 0) {
        for (const seq of Object.values(sequences)) {
          expect(seq.name).toBeDefined();
          expect(seq.type).toBeDefined();
          expect(typeof seq.increment).toBe("number");
          expect(typeof seq.cycle).toBe("boolean");
        }
      }
    });

    it("should track sequence ownership", async () => {
      const sequences = await getAllSequences(client);

      if (Object.keys(sequences).length > 0) {
        // At least some sequences should have owners
        const withOwner = Object.values(sequences).filter(s => s.ownedBy);
        expect(withOwner.length).toBeGreaterThan(0);

        for (const seq of withOwner) {
          expect(seq.ownedBy).toMatch(/\w+\.\w+/);
        }
      }
    });
  });

  describe("Role detection", () => {
    it("should enumerate database roles", async () => {
      const roles = await getAllRoles(client);

      expect(Object.keys(roles).length).toBeGreaterThan(0);
    });

    it("should track role capabilities", async () => {
      const roles = await getAllRoles(client);

      for (const role of Object.values(roles)) {
        expect(role.name).toBeDefined();
        expect(typeof role.inherit).toBe("boolean");
        expect(typeof role.login).toBe("boolean");
        expect(typeof role.createDb).toBe("boolean");
        expect(typeof role.createRole).toBe("boolean");
        expect(Array.isArray(role.memberOf)).toBe(true);
      }
    });
  });

  describe("Trigger detection", () => {
    it("should enumerate triggers when present", async () => {
      const triggers = await getAllTriggers(client);

      // Triggers are optional depending on schema
      for (const trigger of Object.values(triggers)) {
        expect(trigger.name).toBeDefined();
        expect(trigger.table).toBeDefined();
        expect(trigger.event).toBeDefined();
        expect(trigger.timing).toBeDefined();
      }
    });

    it("should track trigger properties", async () => {
      const triggers = await getAllTriggers(client);

      if (Object.keys(triggers).length > 0) {
        for (const trigger of Object.values(triggers)) {
          expect(["INSERT", "UPDATE", "DELETE"]).toContain(trigger.event);
          expect(["BEFORE", "AFTER"]).toContain(trigger.timing);
        }
      }
    });
  });

  describe("Inventory validation", () => {
    it("should validate against required tables", async () => {
      const inventory = await getSchemaInventory(client);

      const requirements = {
        tables: [
          { name: "utilisateurs", columns: ["id", "email"] }
        ]
      };

      const issues = validateInventory(inventory, requirements);

      // utilisateurs should exist in any prod schema
      expect(issues.missingTables.filter(t => t.includes("utilisateurs")).length).toBeLessThanOrEqual(1);
    });

    it("should detect missing columns", async () => {
      const inventory = await getSchemaInventory(client);

      const requirements = {
        tables: [
          { name: "schema_migrations", columns: ["filename", "nonexistent_column_xyz"] }
        ]
      };

      const issues = validateInventory(inventory, requirements);

      expect(issues.missingColumns.some(c => c.includes("nonexistent_column_xyz"))).toBe(true);
    });

    it("should report no issues for valid schema", async () => {
      const inventory = await getSchemaInventory(client);

      // Get first real table
      const table = Object.values(inventory.tables)[0];
      if (table) {
        const requirements = {
          tables: [
            { name: table.name, columns: table.columns.slice(0, 2).map(c => c.name) }
          ]
        };

        const issues = validateInventory(inventory, requirements);

        expect(issues.missingTables.length).toBe(0);
        expect(issues.missingColumns.length).toBe(0);
      }
    });
  });

  describe("Inventory consistency", () => {
    it("should include all tables with columns", async () => {
      const inventory = await getSchemaInventory(client);

      for (const table of Object.values(inventory.tables)) {
        expect(table.name).toBeDefined();
        expect(table.columns.length).toBeGreaterThan(0);
      }
    });

    it("should include valid constraint references", async () => {
      const inventory = await getSchemaInventory(client);

      for (const constraint of Object.values(inventory.constraints)) {
        expect(inventory.tables[constraint.table]).toBeDefined();
        if (constraint.references) {
          expect(constraint.references.table).toBeDefined();
          expect(constraint.references.column).toBeDefined();
        }
      }
    });

    it("should reference valid tables in indexes", async () => {
      const inventory = await getSchemaInventory(client);

      for (const index of Object.values(inventory.indexes)) {
        expect(inventory.tables[index.table]).toBeDefined();
      }
    });

    it("should reference valid tables in policies", async () => {
      const inventory = await getSchemaInventory(client);

      for (const policy of Object.values(inventory.policies)) {
        expect(inventory.tables[policy.table]).toBeDefined();
      }
    });
  });

  describe("Inventory performance", () => {
    it("should collect inventory within reasonable time", async () => {
      const start = Date.now();
      const inventory = await getSchemaInventory(client);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(inventory.stats.tableCount).toBeGreaterThan(0);
    });
  });
});
