/**
 * Inspect Migration State
 * Diagnoses the actual state of migrations vs database schema
 * Identifies if migrations are marked applied but tables don't exist
 */

async function inspectMigrationState(client) {
  if (!client) {
    throw new Error("inspectMigrationState requires a database client");
  }

  console.log("\n📋 MIGRATION STATE INSPECTION");
  console.log("=".repeat(60));

  // 1. Get database connection info
  const connInfo = await client.query(`
    SELECT 
      current_database() as database_name,
      current_user as current_user,
      inet_server_addr() as server_addr,
      inet_server_port() as server_port
  `);
  const conn = connInfo.rows[0];
  console.log(`\n🔗 Database Connection:`);
  console.log(`   Database: ${conn.database_name}`);
  console.log(`   User: ${conn.current_user}`);
  console.log(`   Server: ${conn.server_addr || "localhost"}:${conn.server_port || 5432}`);

  // 2. Check which migration tracking table exists
  const hasSchemaMigrations = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'schema_migrations'
    ) as exists
  `);
  const hasSchemaMigrationsExecuted = await client.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_name = 'schema_migrations_executed'
    ) as exists
  `);

  console.log(`\n📊 Migration Tracking Tables:`);
  console.log(`   schema_migrations: ${hasSchemaMigrations.rows[0].exists ? "✅ EXISTS" : "❌ MISSING"}`);
  console.log(`   schema_migrations_executed: ${hasSchemaMigrationsExecuted.rows[0].exists ? "✅ EXISTS" : "❌ MISSING"}`);

  // 3. Get migration count
  let appliedMigrations = [];
  if (hasSchemaMigrations.rows[0].exists) {
    const result = await client.query(`
      SELECT filename FROM schema_migrations ORDER BY filename
    `);
    appliedMigrations = result.rows.map(r => r.filename);
  } else if (hasSchemaMigrationsExecuted.rows[0].exists) {
    const result = await client.query(`
      SELECT version FROM schema_migrations_executed ORDER BY version
    `);
    appliedMigrations = result.rows.map(r => r.version);
  }

  console.log(`\n📈 Applied Migrations: ${appliedMigrations.length}`);
  if (appliedMigrations.length > 0) {
    console.log(`   First: ${appliedMigrations[0]}`);
    console.log(`   Last: ${appliedMigrations[appliedMigrations.length - 1]}`);
  }

  // 4. Check critical tables
  const criticalTables = ["notifications", "outbox_events", "cron_execution_logs"];
  console.log(`\n🔍 Critical Tables Status:`);
  
  for (const table of criticalTables) {
    const exists = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = $1
      ) as exists
    `, [table]);
    
    const isApplied = appliedMigrations.some(m => {
      if (table === "notifications") return m.includes("034_retention_phase3");
      if (table === "outbox_events") return m.includes("050_outbox_events");
      if (table === "cron_execution_logs") return m.includes("051_cron_execution_logs");
      return false;
    });

    const status = exists.rows[0].exists ? "✅ EXISTS" : "❌ MISSING";
    const applied = isApplied ? "✅ APPLIED" : "❌ NOT APPLIED";
    const mismatch = exists.rows[0].exists !== isApplied ? " ⚠️ MISMATCH!" : "";
    
    console.log(`   ${table}: ${status} | ${applied}${mismatch}`);
  }

  // 5. Check for specific migrations
  console.log(`\n🔎 Specific Migration Files:`);
  const specificMigrations = [
    "034_retention_phase3.sql",
    "050_outbox_events.sql",
    "051_cron_execution_logs.sql"
  ];

  for (const migration of specificMigrations) {
    const found = appliedMigrations.includes(migration);
    console.log(`   ${migration}: ${found ? "✅ RECORDED" : "❌ NOT RECORDED"}`);
  }

  // 6. Check for duplicate migration numbers
  console.log(`\n⚠️  Duplicate Migration Numbers:`);
  const migrationNumbers = new Map();
  for (const m of appliedMigrations) {
    const num = m.match(/^\d+/)?.[0];
    if (num) {
      if (!migrationNumbers.has(num)) {
        migrationNumbers.set(num, []);
      }
      migrationNumbers.get(num).push(m);
    }
  }

  let hasDuplicates = false;
  for (const [num, files] of migrationNumbers) {
    if (files.length > 1) {
      console.log(`   ${num}: ${files.join(", ")}`);
      hasDuplicates = true;
    }
  }
  if (!hasDuplicates) {
    console.log(`   None found ✅`);
  }

  // 7. Summary
  console.log(`\n📝 SUMMARY:`);
  const criticalTablesMissing = criticalTables.filter(t => {
    const isApplied = appliedMigrations.some(m => {
      if (t === "notifications") return m.includes("034_retention_phase3");
      if (t === "outbox_events") return m.includes("050_outbox_events");
      if (t === "cron_execution_logs") return m.includes("051_cron_execution_logs");
      return false;
    });
    return !isApplied;
  });

  if (criticalTablesMissing.length > 0) {
    console.log(`   ❌ CRITICAL: ${criticalTablesMissing.length} critical migrations not recorded`);
    console.log(`      Missing: ${criticalTablesMissing.join(", ")}`);
  } else {
    console.log(`   ✅ All critical migrations recorded`);
  }

  return {
    database: conn.database_name,
    user: conn.current_user,
    server: conn.server_addr || "localhost",
    port: conn.server_port || 5432,
    appliedCount: appliedMigrations.length,
    appliedMigrations,
    criticalTablesMissing
  };
}

module.exports = { inspectMigrationState };
