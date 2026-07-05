const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, spawn } = require("child_process");
const net = require("net");
const { Pool } = require("pg");

const PG_BIN_DIR = "C:\\Program Files\\PostgreSQL\\18\\bin";
const STATE_FILE = path.join(os.tmpdir(), "madsuite-backend-pg-test-state.json");

function getBinPath(exeName) {
  return path.join(PG_BIN_DIR, exeName);
}

function run(exeName, args, options = {}) {
  const result = spawnSync(getBinPath(exeName), args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${exeName} ${args.join(" ")} failed${output ? `: ${output}` : ""}`);
  }

  return result;
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return null;

  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(500, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

function chooseFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (!port) {
          reject(new Error("Unable to choose a free port for the PostgreSQL test cluster."));
          return;
        }
        resolve(port);
      });
    });
  });
}

function hasProvidedPostgresService() {
  return Boolean(process.env.POSTGRES_ADMIN_URL || process.env.TEST_DATABASE_URL || process.env.CI);
}

function inferConnectionSettingsFromUrl(connectionString) {
  if (!connectionString) return null;

  try {
    const url = new URL(connectionString);
    return {
      host: url.hostname || "localhost",
      port: url.port || "5432",
      user: decodeURIComponent(url.username || "postgres"),
      password: decodeURIComponent(url.password || ""),
    };
  } catch {
    return null;
  }
}

function buildDefaultProvidedUrls() {
  const user = encodeURIComponent(process.env.DB_USER || "postgres");
  const password = encodeURIComponent(process.env.DB_PASSWORD || "change_me");
  const host = process.env.DB_HOST || "localhost";
  const port = process.env.DB_PORT || "5432";

  process.env.TEST_DATABASE_URL ||= `postgresql://${user}:${password}@${host}:${port}/madsuite_test`;
  process.env.POSTGRES_ADMIN_URL ||= `postgresql://${user}:${password}@${host}:${port}/postgres`;
}

async function waitForProvidedPostgres(timeoutMs = 30000) {
  buildDefaultProvidedUrls();

  const inferred = inferConnectionSettingsFromUrl(process.env.POSTGRES_ADMIN_URL) ||
    inferConnectionSettingsFromUrl(process.env.TEST_DATABASE_URL);

  if (inferred) {
    process.env.DB_HOST ||= inferred.host;
    process.env.DB_PORT ||= inferred.port;
    process.env.DB_USER ||= inferred.user;
    process.env.DB_PASSWORD ||= inferred.password;
  }

  const pool = new Pool({ connectionString: process.env.POSTGRES_ADMIN_URL });
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  try {
    while (Date.now() < deadline) {
      try {
        await pool.query("SELECT 1");
        return {
          provided: true,
          adminUrl: process.env.POSTGRES_ADMIN_URL,
          testUrl: process.env.TEST_DATABASE_URL,
        };
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  } finally {
    await pool.end().catch(() => null);
  }

  throw new Error(`Provided PostgreSQL service is not ready: ${lastError?.message || "timeout"}`);
}

async function startBackendTestCluster() {
  if (hasProvidedPostgresService()) {
    return waitForProvidedPostgres();
  }

  const existing = readState();
  if (existing?.dataDir && (await isPortOpen(existing.port))) {
    process.env.BACKEND_TEST_PG_PORT = String(existing.port);
    process.env.DB_HOST = "localhost";
    process.env.DB_PORT = String(existing.port);
    process.env.TEST_DATABASE_URL = `postgresql://postgres:change_me@localhost:${existing.port}/madsuite_test`;
    process.env.POSTGRES_ADMIN_URL = `postgresql://postgres:change_me@localhost:${existing.port}/postgres`;
    return existing;
  }

  try {
    fs.rmSync(STATE_FILE, { force: true });
  } catch {
    // ignore
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "madsuite-backend-pg-"));
  const port = Number(process.env.BACKEND_TEST_PG_PORT || (await chooseFreePort()));
  run("initdb.exe", [
    "-D",
    dataDir,
    "-U",
    "postgres",
    "--auth-local=trust",
    "--auth-host=trust",
    "--no-instructions",
  ]);

  const postgresConf = path.join(dataDir, "postgresql.conf");
  fs.appendFileSync(
    postgresConf,
    [
      "",
      "# MADSuite test cluster",
      `port = ${port}`,
      "listen_addresses = '127.0.0.1'",
    ].join("\n"),
    "utf8",
  );

  const logFile = path.join(dataDir, "postgresql.log");
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  const postgres = spawn(
    getBinPath("postgres.exe"),
    ["-D", dataDir, "-p", String(port), "-h", "127.0.0.1"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  postgres.stdout?.pipe(logStream);
  postgres.stderr?.pipe(logStream);

  const started = await waitForPort(port);
  if (!started) {
    try {
      logStream.end();
    } catch {
      // ignore
    }
    try {
      spawnSync("taskkill", ["/PID", String(postgres.pid), "/T", "/F"], { windowsHide: true });
    } catch {
      // ignore
    }
    const logContent = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
    throw new Error(`PostgreSQL test cluster did not open port ${port} in time.${logContent ? `\n${logContent}` : ""}`);
  }
  logStream.end();

  const state = { dataDir, port, pid: postgres.pid };
  writeState(state);
  process.env.BACKEND_TEST_PG_PORT = String(port);
  process.env.DB_HOST = "localhost";
  process.env.DB_PORT = String(port);
  process.env.TEST_DATABASE_URL = `postgresql://postgres:change_me@localhost:${port}/madsuite_test`;
  process.env.POSTGRES_ADMIN_URL = `postgresql://postgres:change_me@localhost:${port}/postgres`;
  return state;
}

async function waitForPort(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function stopBackendTestCluster() {
  const state = readState();
  if (!state?.dataDir) return;

  try {
    if (state.pid) {
      spawnSync("taskkill", ["/PID", String(state.pid), "/T", "/F"], { windowsHide: true });
    }
  } finally {
    try {
      fs.rmSync(state.dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(STATE_FILE, { force: true });
    } catch {
      // ignore
    }
  }
}

module.exports = {
  startBackendTestCluster,
  stopBackendTestCluster,
  STATE_FILE,
};