require("dotenv").config({ path: ".env.test" });
const { Client } = require("pg");
(async () => {
  const client = new Client({
    host: process.env.DB_HOST, port: process.env.DB_PORT,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    database: "postgres",
  });
  await client.connect();
  const r = await client.query("SELECT count(*) FROM pg_stat_activity");
  console.log("connexions actives:", r.rows[0].count);
  const s = await client.query("SHOW max_connections");
  console.log("max_connections:", s.rows[0].max_connections);
  await client.end();
})();
