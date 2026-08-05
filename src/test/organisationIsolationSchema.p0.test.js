/**
 * P0 — Garde-fou schéma: isolation par organisation (Issue #174 PR B)
 *
 * Constat initial (2026-08-05): 142 tables possédaient une colonne
 * organisation_id sans aucune policy RLS — seul un filtre applicatif manuel
 * (WHERE organisation_id = $1) protégeait ces données, sans filet de
 * sécurité au niveau base si une requête, un job ou une jointure future
 * omettait ce filtre. Voir migration 20260805_stage6_pr_b_organisation_isolation.sql.
 *
 * Ce test empêche la régression: toute nouvelle table portant une colonne
 * organisation_id doit obligatoirement activer RLS + FORCE ROW LEVEL SECURITY
 * et exposer au moins une policy comparant organisation_id à
 * app.current_organisation_id, sous peine de faire échouer la suite.
 */

const db = require("../../db");

describe("P0: schéma — toute table organisation_id doit être protégée par RLS", () => {
  let tablesWithOrgColumn;
  let tablesWithRlsEnabled;
  let tablesForced;
  let policiesByTable;

  beforeAll(async () => {
    const columnResult = await db.pool.query(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
        AND a.attname = 'organisation_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);
    tablesWithOrgColumn = columnResult.rows.map((r) => r.table_name);

    const rlsResult = await db.pool.query(`
      SELECT c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r';
    `);
    tablesWithRlsEnabled = new Set(
      rlsResult.rows.filter((r) => r.relrowsecurity).map((r) => r.table_name),
    );
    tablesForced = new Set(
      rlsResult.rows.filter((r) => r.relforcerowsecurity).map((r) => r.table_name),
    );

    const policyResult = await db.pool.query(`
      SELECT tablename, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public';
    `);
    policiesByTable = new Map();
    for (const row of policyResult.rows) {
      const list = policiesByTable.get(row.tablename) || [];
      list.push(row);
      policiesByTable.set(row.tablename, list);
    }
  });

  test("au moins une table organisation_id est recensée (le test lui-même n'est pas vide)", () => {
    expect(tablesWithOrgColumn.length).toBeGreaterThan(50);
  });

  test("chaque table organisation_id a RLS activé (ENABLE ROW LEVEL SECURITY)", () => {
    const missing = tablesWithOrgColumn.filter((t) => !tablesWithRlsEnabled.has(t));
    expect(missing).toEqual([]);
  });

  test("chaque table organisation_id force RLS même pour le propriétaire (FORCE ROW LEVEL SECURITY)", () => {
    const missing = tablesWithOrgColumn.filter((t) => !tablesForced.has(t));
    expect(missing).toEqual([]);
  });

  test("chaque table organisation_id expose une policy comparant organisation_id à app.current_organisation_id", () => {
    const missingPolicy = [];
    const weakPolicy = [];

    for (const table of tablesWithOrgColumn) {
      const policies = policiesByTable.get(table) || [];
      if (policies.length === 0) {
        missingPolicy.push(table);
        continue;
      }

      const hasScopedPolicy = policies.some((p) => {
        const clause = `${p.qual || ""} ${p.with_check || ""}`;
        return clause.includes("organisation_id") && clause.includes("current_organisation_id");
      });

      if (!hasScopedPolicy) {
        weakPolicy.push(table);
      }
    }

    expect(missingPolicy).toEqual([]);
    expect(weakPolicy).toEqual([]);
  });
});
