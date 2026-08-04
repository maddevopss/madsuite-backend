/**
 * Schema Inventory Tool
 *
 * Comprehensive database schema scanning:
 * - All tables with columns and data types
 * - Constraints (PK, FK, UNIQUE, CHECK, NOT NULL)
 * - Indexes and their columns
 * - Row-level security policies
 * - Roles and permissions
 * - Sequences and ownership
 * - Triggers and their timing
 */

async function getSchemaInventory(providedClient = null) {
  let client = providedClient;
  let shouldRelease = false;

  if (!client) {
    client = await require("../../db").pool.connect();
    shouldRelease = true;
  }

  const inventory = {
    timestamp: new Date().toISOString(),
    tables: {},
    constraints: {},
    indexes: {},
    policies: {},
    sequences: {},
    roles: {},
    triggers: {},
    stats: {}
  };

  try {
    // Tables and columns
    inventory.tables = await getAllTables(client);
    inventory.stats.tableCount = Object.keys(inventory.tables).length;

    // Constraints
    inventory.constraints = await getAllConstraints(client);
    inventory.stats.constraintCount = Object.keys(inventory.constraints).length;

    // Indexes
    inventory.indexes = await getAllIndexes(client);
    inventory.stats.indexCount = Object.keys(inventory.indexes).length;

    // RLS Policies
    inventory.policies = await getAllPolicies(client);
    inventory.stats.policyCount = Object.keys(inventory.policies).length;

    // Sequences
    inventory.sequences = await getAllSequences(client);
    inventory.stats.sequenceCount = Object.keys(inventory.sequences).length;

    // Roles
    inventory.roles = await getAllRoles(client);
    inventory.stats.roleCount = Object.keys(inventory.roles).length;

    // Triggers
    inventory.triggers = await getAllTriggers(client);
    inventory.stats.triggerCount = Object.keys(inventory.triggers).length;

  } catch (err) {
    throw new Error(`Schema inventory error: ${err.message}`, { cause: err });
  } finally {
    if (shouldRelease) {
      client.release();
    }
  }

  return inventory;
}

async function getAllTables(client) {
  const result = await client.query(`
    SELECT
      t.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default,
      c.ordinal_position
    FROM information_schema.tables t
    LEFT JOIN information_schema.columns c ON t.table_name = c.table_name
      AND t.table_schema = c.table_schema
    WHERE t.table_schema = current_schema()
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position
  `);

  const tables = {};
  for (const row of result.rows) {
    if (!tables[row.table_name]) {
      tables[row.table_name] = {
        name: row.table_name,
        columns: []
      };
    }
    if (row.column_name) {
      tables[row.table_name].columns.push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default,
        position: row.ordinal_position
      });
    }
  }

  return tables;
}

async function getAllConstraints(client) {
  const result = await client.query(`
    SELECT
      tc.constraint_name,
      tc.table_name,
      tc.constraint_type,
      kcu.column_name,
      ccu.table_name as foreign_table,
      ccu.column_name as foreign_column,
      rc.update_rule,
      rc.delete_rule
    FROM information_schema.table_constraints tc
    LEFT JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    LEFT JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    LEFT JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
      AND tc.table_schema = rc.constraint_schema
    WHERE tc.table_schema = current_schema()
    ORDER BY tc.table_name, tc.constraint_name
  `);

  const constraints = {};
  for (const row of result.rows) {
    const key = `${row.table_name}.${row.constraint_name}`;
    if (!constraints[key]) {
      constraints[key] = {
        name: row.constraint_name,
        table: row.table_name,
        type: row.constraint_type,
        columns: []
      };
      if (row.foreign_table) {
        constraints[key].references = {
          table: row.foreign_table,
          column: row.foreign_column,
          updateRule: row.update_rule,
          deleteRule: row.delete_rule
        };
      }
    }
    if (row.column_name) {
      constraints[key].columns.push(row.column_name);
    }
  }

  return constraints;
}

async function getAllIndexes(client) {
  const result = await client.query(`
    SELECT
      i.indexname,
      i.tablename,
      a.attname,
      ix.indisprimary,
      ix.indisunique,
      ix.indisvalid
    FROM pg_indexes i
    JOIN pg_class t ON t.relname = i.tablename
    JOIN pg_index ix ON ix.indrelid = t.oid
    JOIN pg_class idx ON idx.oid = ix.indexrelid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE schemaname = current_schema()
      AND t.relname NOT LIKE 'pg_%'
    ORDER BY i.tablename, i.indexname, a.attnum
  `);

  const indexes = {};
  for (const row of result.rows) {
    const key = `${row.tablename}.${row.indexname}`;
    if (!indexes[key]) {
      indexes[key] = {
        name: row.indexname,
        table: row.tablename,
        isPrimary: row.indisprimary,
        isUnique: row.indisunique,
        isValid: row.indisvalid,
        columns: []
      };
    }
    indexes[key].columns.push(row.attname);
  }

  return indexes;
}

async function getAllPolicies(client) {
  const result = await client.query(`
    SELECT
      p.polname as policyname,
      c.relname as table_name,
      p.polpermissive as permissive,
      p.polcmd as cmd,
      pg_get_expr(p.polqual, p.polrelid) as qual,
      pg_get_expr(p.polwithcheck, p.polrelid) as with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
    ORDER BY c.relname, p.polname
  `);

  const policies = {};
  for (const row of result.rows) {
    const key = `${row.table_name}.${row.policyname}`;
    policies[key] = {
      name: row.policyname,
      table: row.table_name,
      permissive: row.permissive,
      command: row.cmd,
      qualExpression: row.qual,
      withCheckExpression: row.with_check
    };
  }

  return policies;
}

async function getAllSequences(client) {
  const result = await client.query(`
    SELECT
      s.sequence_name,
      s.data_type,
      s.start_value,
      s.minimum_value,
      s.maximum_value,
      s.increment,
      s.cycle_option,
      tbl.relname as table_name,
      col.attname as column_name
    FROM information_schema.sequences s
    LEFT JOIN pg_class seq ON seq.relname = s.sequence_name AND seq.relkind = 'S'
    LEFT JOIN pg_namespace ns ON ns.oid = seq.relnamespace AND ns.nspname = s.sequence_schema
    LEFT JOIN pg_depend dep ON dep.objid = seq.oid AND dep.deptype = 'a'
    LEFT JOIN pg_class tbl ON tbl.oid = dep.refobjid
    LEFT JOIN pg_attribute col ON col.attrelid = tbl.oid AND col.attnum = dep.refobjsubid
    WHERE s.sequence_schema = current_schema()
    ORDER BY s.sequence_name
  `);

  const sequences = {};
  for (const row of result.rows) {
    if (!sequences[row.sequence_name]) {
      sequences[row.sequence_name] = {
        name: row.sequence_name,
        type: row.data_type,
        startValue: Number(row.start_value),
        minValue: Number(row.minimum_value),
        maxValue: Number(row.maximum_value),
        increment: Number(row.increment),
        cycle: row.cycle_option === 'YES',
        ownedBy: null
      };
    }
    if (row.table_name) {
      sequences[row.sequence_name].ownedBy = `${row.table_name}.${row.column_name}`;
    }
  }

  return sequences;
}

async function getAllRoles(client) {
  const result = await client.query(`
    SELECT
      r.rolname,
      r.rolinherit,
      r.rolcanlogin,
      r.rolcreatedb,
      r.rolcreaterole,
      r.rolsuper,
      array_agg(DISTINCT m.rolname) FILTER (WHERE m.rolname IS NOT NULL) as member_of
    FROM pg_roles r
    LEFT JOIN pg_auth_members am ON r.oid = am.member
    LEFT JOIN pg_roles m ON am.roleid = m.oid
    WHERE r.rolname NOT LIKE 'pg_%'
    GROUP BY r.oid, r.rolname, r.rolinherit, r.rolcanlogin, r.rolcreatedb, r.rolcreaterole, r.rolsuper
    ORDER BY r.rolname
  `);

  const roles = {};
  for (const row of result.rows) {
    roles[row.rolname] = {
      name: row.rolname,
      inherit: row.rolinherit,
      login: row.rolcanlogin,
      createDb: row.rolcreatedb,
      createRole: row.rolcreaterole,
      superuser: row.rolsuper,
      memberOf: row.member_of || []
    };
  }

  return roles;
}

async function getAllTriggers(client) {
  const result = await client.query(`
    SELECT
      t.trigger_name,
      t.event_manipulation,
      t.event_object_table,
      t.action_timing,
      t.action_orientation,
      t.action_statement
    FROM information_schema.triggers t
    WHERE t.trigger_schema = current_schema()
    ORDER BY t.event_object_table, t.trigger_name
  `);

  const triggers = {};
  for (const row of result.rows) {
    const key = `${row.event_object_table}.${row.trigger_name}`;
    triggers[key] = {
      name: row.trigger_name,
      table: row.event_object_table,
      event: row.event_manipulation,
      timing: row.action_timing,
      orientation: row.action_orientation,
      statement: row.action_statement
    };
  }

  return triggers;
}

/**
 * Compare inventory against expected schema requirements
 */
function validateInventory(inventory, requirements = {}) {
  const issues = {
    missingTables: [],
    missingColumns: [],
    missingConstraints: [],
    missingIndexes: [],
    missingPolicies: [],
    warnings: []
  };

  // Check required tables
  if (requirements.tables) {
    for (const table of requirements.tables) {
      if (!inventory.tables[table.name]) {
        issues.missingTables.push(`Table ${table.name} not found`);
      } else if (table.columns) {
        for (const col of table.columns) {
          const found = inventory.tables[table.name].columns.find(c => c.name === col);
          if (!found) {
            issues.missingColumns.push(`Column ${table.name}.${col} not found`);
          }
        }
      }
    }
  }

  // Check required constraints
  if (requirements.constraints) {
    for (const constraint of requirements.constraints) {
      const found = Object.values(inventory.constraints).find(
        c => c.table === constraint.table && c.name === constraint.name
      );
      if (!found) {
        issues.missingConstraints.push(
          `Constraint ${constraint.table}.${constraint.name} (${constraint.type}) not found`
        );
      }
    }
  }

  // Check required indexes
  if (requirements.indexes) {
    for (const index of requirements.indexes) {
      const found = Object.values(inventory.indexes).find(
        i => i.table === index.table && i.name === index.name
      );
      if (!found) {
        issues.missingIndexes.push(`Index ${index.table}.${index.name} not found`);
      }
    }
  }

  // Check required policies
  if (requirements.policies) {
    for (const policy of requirements.policies) {
      const found = Object.values(inventory.policies).find(
        p => p.table === policy.table && p.name === policy.name
      );
      if (!found) {
        issues.missingPolicies.push(`Policy ${policy.table}.${policy.name} not found`);
      }
    }
  }

  return issues;
}

module.exports = {
  getSchemaInventory,
  validateInventory,
  getAllTables,
  getAllConstraints,
  getAllIndexes,
  getAllPolicies,
  getAllSequences,
  getAllRoles,
  getAllTriggers
};
