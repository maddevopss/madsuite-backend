const path = require("path");
const fs = require("fs");

require("dotenv").config({
  path: path.join(__dirname, "../../.env.test"),
});

process.env.NODE_ENV = "test";
process.env.DB_NAME = process.env.TEST_DB_NAME || "madsuite_test";

process.env.DB_HOST ||= "localhost";
process.env.DB_PORT ||= "5432";
process.env.DB_USER ||= "postgres";
process.env.DB_PASSWORD ||= "change_me";
process.env.JWT_SECRET ||= "test-secret-madsuite-1234567890-ABC";

const stateFile = path.join(require("os").tmpdir(), "madsuite-backend-pg-test-state.json");
if (fs.existsSync(stateFile)) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    if (state?.port) {
      process.env.DB_HOST = "localhost";
      process.env.DB_PORT = String(state.port);
      process.env.TEST_DATABASE_URL = `postgresql://postgres:change_me@localhost:${state.port}/madsuite_test`;
      process.env.POSTGRES_ADMIN_URL = `postgresql://postgres:change_me@localhost:${state.port}/postgres`;
    }
  } catch {
    // Ignore stale state and fall back to .env.test values.
  }
}

const dbUser = encodeURIComponent(process.env.DB_USER || "postgres");
const dbPassword = encodeURIComponent(process.env.DB_PASSWORD || "");
const dbHost = process.env.DB_HOST || "localhost";
const dbPort = process.env.DB_PORT || "5432";

process.env.TEST_DATABASE_URL ||= `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${process.env.DB_NAME}`;
process.env.POSTGRES_ADMIN_URL ||= `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/postgres`;

if (process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
