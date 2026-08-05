const fs = require("fs");
const os = require("os");
const path = require("path");

jest.mock("../../db");

const { applyMigration } = require("../migrate/runMigrations");

function makeFakeClient({ migrationSql, error }) {
  return {
    query: jest.fn(async (sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK" || sql === "COMMIT") return {};
      if (sql === migrationSql) throw error;
      if (typeof sql === "string" && sql.includes("schema_migrations_executed")) {
        return { rows: [{ exists: false }] };
      }
      if (typeof sql === "string" && sql.includes("INSERT INTO schema_migrations")) {
        return { rowCount: 1 };
      }
      return { rows: [] };
    }),
  };
}

function writeTempMigration(sql) {
  const fullPath = path.join(os.tmpdir(), `applyMigration-test-${Date.now()}-${Math.random()}.sql`);
  fs.writeFileSync(fullPath, sql, "utf8");
  return fullPath;
}

describe("applyMigration - classification des erreurs 'déjà appliquée'", () => {
  test("code 42710 (duplicate_object) est traité comme non-fatal", async () => {
    const sql = "CREATE TYPE foo AS ENUM ('a');";
    const fullPath = writeTempMigration(sql);
    const error = Object.assign(new Error('type "foo" already exists'), { code: "42710" });
    const client = makeFakeClient({ migrationSql: sql, error });

    await expect(applyMigration(client, { fullPath, file: "001_foo.sql" })).resolves.toBeUndefined();
  });

  test("code 42P07 (duplicate_table) est traité comme non-fatal", async () => {
    const sql = "CREATE TABLE foo (id int);";
    const fullPath = writeTempMigration(sql);
    const error = Object.assign(new Error('relation "foo" already exists'), { code: "42P07" });
    const client = makeFakeClient({ migrationSql: sql, error });

    await expect(applyMigration(client, { fullPath, file: "002_foo.sql" })).resolves.toBeUndefined();
  });

  test("undefined_column (42703) avec message français 'n'existe pas' reste fatal (ne doit pas être confondu avec 'existe')", async () => {
    const sql = "CREATE VIEW v AS SELECT recovery_attempts FROM foo;";
    const fullPath = writeTempMigration(sql);
    const error = Object.assign(new Error("la colonne « recovery_attempts » n'existe pas"), { code: "42703" });
    const client = makeFakeClient({ migrationSql: sql, error });

    await expect(applyMigration(client, { fullPath, file: "003_broken_view.sql" })).rejects.toThrow(
      /n'existe pas/,
    );
  });

  test("erreur générique sans code de duplication reste fatale", async () => {
    const sql = "SELECT * FROM totally_broken_syntax !!!;";
    const fullPath = writeTempMigration(sql);
    const error = Object.assign(new Error("syntax error"), { code: "42601" });
    const client = makeFakeClient({ migrationSql: sql, error });

    await expect(applyMigration(client, { fullPath, file: "004_syntax_error.sql" })).rejects.toThrow(
      /syntax error/,
    );
  });
});
