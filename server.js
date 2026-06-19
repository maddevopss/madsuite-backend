const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, process.env.NODE_ENV === "test" ? ".env.test" : ".env"),
  override: false,
});

const validateEnv = require("./src/config/validateEnv");
const app = require("./src/app");
const pool = require("./db");
const { startSchedulers } = require("./src/jobs/scheduler");
const { runMigrations } = require("./src/migrate/runMigrations");
const { initRetentionJob } = require("./src/jobs/dataRetention");

validateEnv();

const PORT = process.env.PORT || 5000;
let serverHttp;
let io;
let schedulerTasks = [];

async function shutdown(signal) {
  console.log(`Arret serveur (${signal})...`);
  schedulerTasks.forEach((task) => task?.stop?.());
  await new Promise((resolve) => {
    if (!serverHttp) {
      resolve();
      return;
    }
    serverHttp.close(resolve);
  });
  await pool.end();
  process.exit(0);
}

async function start() {
  await runMigrations({ backup: process.env.ENABLE_DB_BACKUP === "1" });

  const http = require("http");
  const server = http.createServer(app);
  const { Server } = require("socket.io");
  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
  });
  app.set("io", io);
  // Load hub socket handlers
  require("./src/socket/hub.socket")(io);

  serverHttp = server.listen(PORT, () => {
    console.log(`Serveur demarre sur le port ${PORT}`);
    schedulerTasks = startSchedulers();
    initRetentionJob(pool);
  });
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((err) => {
    console.error("Erreur shutdown SIGTERM", err);
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((err) => {
    console.error("Erreur shutdown SIGINT", err);
    process.exit(1);
  });
});

start().catch((err) => {
  console.error("Demarrage echoue (migrations)", err);
  process.exit(1);
});
