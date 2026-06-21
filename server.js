const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, process.env.NODE_ENV === "test" ? ".env.test" : ".env"),
  override: false,
});

// INITIALISATION DE SENTRY
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}

// IMPORTS REQUIS
const http = require("http");
const { Server } = require("socket.io");
const validateEnv = require("./src/config/validateEnv");
const app = require("./src/app");
const pool = require("./db");
const { startSchedulers } = require("./src/jobs/scheduler");
const { runMigrations } = require("./src/migrate/runMigrations");
const { initRetentionJob } = require("./src/jobs/dataRetention");
const { startTrialReminderJob } = require("./src/jobs/trialReminderJob");

// VALIDATE ENV EARLY
validateEnv();

// CONSTANTS
const PORT = process.env.PORT || 5000;

// STATE VARIABLES (une seule déclaration)
let serverHttp;
let io;
let schedulerTasks = [];

/**
 * Graceful shutdown handler
 * Stops schedulers, closes server, ends DB connection
 */
async function shutdown(signal) {
  console.log(`🛑 Arrêt serveur (${signal})...`);

  // Stop all scheduled tasks
  schedulerTasks.forEach((task) => {
    try {
      task?.stop?.();
    } catch (err) {
      console.error(`Erreur lors de l'arrêt du scheduler: ${err.message}`);
    }
  });

  // Close HTTP server
  await new Promise((resolve) => {
    if (!serverHttp) {
      resolve();
      return;
    }
    serverHttp.close(() => {
      console.log("✅ Serveur HTTP fermé");
      resolve();
    });
  });

  // Close database connection
  try {
    await pool.end();
    console.log("✅ Connexion base de données fermée");
  } catch (err) {
    console.error("Erreur lors de la fermeture de la BD:", err);
  }

  process.exit(0);
}

/**
 * Initialize Socket.IO server
 * Sets up CORS and loads socket handlers
 */
function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Set io on app for use in routes
  app.set("io", io);

  // Load socket event handlers
  require("./src/socket/hub.socket")(io);

  console.log("✅ Socket.IO initialisé");

  return io;
}

/**
 * Start the application
 */
async function start() {
  try {
    console.log("🚀 Démarrage du serveur...");

    // 1. Run database migrations
    console.log("📦 Exécution des migrations...");
    // await runMigrations({
    //   backup: process.env.ENABLE_DB_BACKUP === "1",
    // });
    console.log("✅ Migrations terminées");

    // 2. Create HTTP server
    const server = http.createServer(app);

    // 3. Initialize Socket.IO
    initializeSocket(server);

    // 4. Start listening
    serverHttp = server.listen(PORT, "0.0.0.0", () => {
      console.log(`🌐 Serveur démarré sur le port ${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV || "development"}`);

      // 5. Start background jobs
      console.log("⏰ Démarrage des scheduleurs...");
      schedulerTasks = startSchedulers();
      initRetentionJob(pool);
      startTrialReminderJob();
      console.log("✅ Scheduleurs lancés");
    });

    // Handle server errors
    serverHttp.on("error", (err) => {
      console.error("❌ Erreur serveur HTTP:", err);
      shutdown("HTTP_ERROR").catch(console.error);
    });
  } catch (err) {
    console.error("❌ Erreur lors du démarrage:", err.message);
    process.exit(1);
  }
}

/**
 * Graceful shutdown on SIGTERM
 * (Kubernetes, Docker, PM2, etc.)
 */
process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((err) => {
    console.error("❌ Erreur shutdown SIGTERM:", err);
    process.exit(1);
  });
});

/**
 * Graceful shutdown on SIGINT
 * (Ctrl+C)
 */
process.on("SIGINT", () => {
  shutdown("SIGINT").catch((err) => {
    console.error("❌ Erreur shutdown SIGINT:", err);
    process.exit(1);
  });
});

/**
 * Uncaught exceptions
 */
process.on("uncaughtException", (err) => {
  console.error("❌ Exception non capturée:", err);
  shutdown("UNCAUGHT_EXCEPTION").catch(console.error);
});

/**
 * Unhandled promise rejections
 */
process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Promise rejetée non gérée:", reason);
  shutdown("UNHANDLED_REJECTION").catch(console.error);
});

// Start the application
start();
