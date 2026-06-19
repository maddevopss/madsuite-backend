const { Client } = require('pg');

async function main() {
  const client = new Client({
    user: 'postgres',
    password: '1234',
    host: 'localhost',
    port: 5432,
    database: 'postgres'
  });

  try {
    await client.connect();
    
    // Check if madsuite exists
    const res = await client.query("SELECT 1 FROM pg_database WHERE datname = 'madsuite'");
    if (res.rows.length === 0) {
      console.log("Database 'madsuite' does not exist. Creating...");
      // Try to rename chronoMAD to madsuite, if it exists
      const chronoRes = await client.query("SELECT 1 FROM pg_database WHERE datname = 'chronoMAD'");
      if (chronoRes.rows.length > 0) {
        // Must disconnect all users first
        await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'chronoMAD' AND pid <> pg_backend_pid()");
        await client.query('ALTER DATABASE "chronoMAD" RENAME TO "madsuite"');
        console.log("Renamed 'chronoMAD' to 'madsuite'");
      } else {
        await client.query('CREATE DATABASE "madsuite"');
        console.log("Created 'madsuite'");
      }
    } else {
      console.log("Database 'madsuite' already exists.");
    }
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

main();
