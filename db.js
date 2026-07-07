const path = require("path");
const { Pool } = require("pg");
const dotenv = require("dotenv");
const dbStore = require("./src/utils/dbStore");

dotenv.config({
  path: path.resolve(__dirname, process.env.NODE_ENV === "test" ? ".env.test" : ".env"),
  override: false,
});

const connectionString = process.env.NODE_ENV === "test" ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

function getDatabaseNameFromConnectionString(value) {
  if (!value) return null;

  try {
    return new URL(value).pathname.replace(/^\//, "") || null;
  } catch {
    return null;
  }
}

function assertSafeTestDatabase(config) {
  if (process.env.NODE_ENV !== "test") return;

  const databaseName =
    getDatabaseNameFromConnectionString(config.connectionString) ||
    config.database ||
    process.env.TEST_DB_NAME ||
    process.env.DB_NAME;

  if (!databaseName || !databaseName.endsWith("_test")) {
    throw new Error(
      `Refus de lancer les tests sur une base non-test: ${databaseName || "inconnue"}. ` +
        "Configure TEST_DB_NAME ou TEST_DATABASE_URL avec un nom qui finit par _test.",
    );
  }
}

const poolConfig = connectionString
  ? {
      connectionString,
      ssl: connectionString.includes("neon.tech") || process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
    }
  : {
      user: process.env.DB_USER,
      host: process.env.DB_HOST,
      database: process.env.NODE_ENV === "test" ? process.env.TEST_DB_NAME || "madsuite_test" : process.env.DB_NAME,
      password: process.env.DB_PASSWORD === undefined ? undefined : String(process.env.DB_PASSWORD),
      port: Number(process.env.DB_PORT),
    };

Object.assign(poolConfig, {
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 15000),
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 15000),
});

assertSafeTestDatabase(poolConfig);

const pool = new Pool(poolConfig);

/**
 * Proxy pour l'exécution des requêtes
 */
const db = {
  query: (text, params) => {
    const store = dbStore.getStore();
    const executor = store?.dbClient || pool;
    return executor.query(text, params);
  },
  getMetrics: () => ({
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
    max: pool.options.max,
  }),
  connect: () => pool.connect(),
  end: () => pool.end(),
  pool,
};

pool.on("error", (err) => {
  if (process.env.NODE_ENV === "test") {
    return;
  }

  console.error("PG pool unexpected error:", err);
});

const testConnection = async () => {
  try {
    const res = await pool.query("SELECT NOW()");
    if (process.env.NODE_ENV !== "test") {
      console.log("PostgreSQL connected:", res.rows[0]);
    }
  } catch (err) {
    console.error("DB connection error:", err.message);
  }
};

if (process.env.NODE_ENV !== "test") {
  testConnection();
}

if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const m = db.getMetrics();
    if (m.waiting > 0 || m.total > m.max * 0.8) {
      console.warn(`[DB Pool Warning] Total: ${m.total}, Idle: ${m.idle}, Waiting: ${m.waiting}`);
    }
  }, 60000);
}

module.exports = db;
