/**
 * Repair Missing Tables
 * Idempotent migration repair for critical tables
 * Creates tables if they don't exist, without dropping or modifying existing data
 */

const fs = require("fs");
const path = require("path");

async function repairMissingTables(client) {
  console.log("\n🔧 REPAIRING MISSING CRITICAL TABLES");
  console.log("=" .repeat(60));

  const criticalMigrations = [
    {
      name: "notifications",
      file: "034_retention_phase3.sql",
      path: path.join(__dirname, "../../db/migrations/034_retention_phase3.sql"),
      createTableOnly: `
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          organisation_id INTEGER REFERENCES organisations(id) ON DELETE CASCADE,
          utilisateur_id INTEGER NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
          type VARCHAR(50) NOT NULL,
          message TEXT NOT NULL,
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uq_notifications_id_org UNIQUE (id, organisation_id)
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(utilisateur_id, is_read);
      `
    },
    {
      name: "outbox_events",
      file: "050_outbox_events.sql",
      path: path.join(__dirname, "../../db/migrations/050_outbox_events.sql"),
      createTableOnly: `
        CREATE TABLE IF NOT EXISTS outbox_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          event_type VARCHAR(100) NOT NULL,
          payload JSONB NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'pending',
          retry_count INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          processed_at TIMESTAMP WITH TIME ZONE,
          next_retry_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_events_status ON outbox_events(status) WHERE status = 'pending';
      `
    },
    {
      name: "cron_execution_logs",
      file: "051_cron_execution_logs.sql",
      path: path.join(__dirname, "../../db/migrations/051_cron_execution_logs.sql"),
      createTableOnly: `
        CREATE TABLE IF NOT EXISTS cron_execution_logs (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          job_name VARCHAR(100) NOT NULL,
          started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP WITH TIME ZONE,
          status VARCHAR(20) NOT NULL,
          error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_job_name ON cron_execution_logs(job_name);
        CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_status ON cron_execution_logs(status);
        CREATE INDEX IF NOT EXISTS idx_cron_execution_logs_started_at ON cron_execution_logs(started_at);
      `
    }
  ];

  const repaired = [];
  const skipped = [];

  for (const migration of criticalMigrations) {
    try {
      // Check if table exists
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables 
          WHERE table_name = $1
        ) as exists
      `, [migration.name]);

      if (tableExists.rows[0].exists) {
        console.log(`✅ ${migration.name}: Already exists, skipping`);
        skipped.push(migration.name);
        continue;
      }

      // Table doesn't exist, create it
      console.log(`🔨 ${migration.name}: Creating...`);
      await client.query(migration.createTableOnly);
      console.log(`✅ ${migration.name}: Created successfully`);
      repaired.push(migration.name);

      // Record in schema_migrations if it exists
      try {
        const hasSchemaMigrations = await client.query(`
          SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_name = 'schema_migrations'
          ) as exists
        `);

        if (hasSchemaMigrations.rows[0].exists) {
          await client.query(
            `INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
            [migration.file]
          );
          console.log(`   └─ Recorded in schema_migrations`);
        }
      } catch (e) {
        console.log(`   └─ Warning: Could not record in schema_migrations: ${e.message}`);
      }
    } catch (error) {
      console.error(`❌ ${migration.name}: Failed to repair`);
      console.error(`   Error: ${error.message}`);
      throw error;
    }
  }

  console.log(`\n📊 Repair Summary:`);
  console.log(`   Repaired: ${repaired.length} (${repaired.join(", ") || "none"})`);
  console.log(`   Skipped: ${skipped.length} (${skipped.join(", ") || "none"})`);

  return {
    repaired,
    skipped,
    success: repaired.length > 0 || skipped.length === criticalMigrations.length
  };
}

module.exports = { repairMissingTables };
