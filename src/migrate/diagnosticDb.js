/**
 * Diagnostic Database Connection
 * Logs connection details without exposing secrets
 * Used to verify migrations and runtime use the same database
 */

const db = require("../../db");

async function diagnosticDatabaseConnection() {
  try {
    const client = await db.pool.connect();
    try {
      // Get connection details without exposing password
      const result = await client.query(`
        SELECT 
          current_database() as database_name,
          current_user as current_user,
          inet_server_addr() as server_addr,
          inet_server_port() as server_port,
          version() as pg_version
      `);

      const info = result.rows[0];
      console.log("📊 Database Connection Diagnostic:");
      console.log(`   Database: ${info.database_name}`);
      console.log(`   User: ${info.current_user}`);
      console.log(`   Server: ${info.server_addr || "localhost"}:${info.server_port || "5432"}`);
      console.log(`   PostgreSQL: ${info.pg_version.split(",")[0]}`);

      return {
        database: info.database_name,
        user: info.current_user,
        server: info.server_addr || "localhost",
        port: info.server_port || 5432,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ Database diagnostic failed:", err.message);
    throw err;
  }
}

module.exports = { diagnosticDatabaseConnection };
