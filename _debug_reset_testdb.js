require("dotenv").config({ path: ".env.test" });
const { Client } = require("pg");
(async () => {
  const client = new Client({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: "postgres",
  });
  await client.connect();
  const dbName = process.env.DB_NAME;
  if (!dbName || !dbName.endsWith("_test")) throw new Error("refus: nom de base non _test: " + dbName);
  await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [dbName]);
  await client.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await client.query(`CREATE DATABASE ${dbName}`);
  console.log("Base de test recreee:", dbName);
  await client.end();
})();
