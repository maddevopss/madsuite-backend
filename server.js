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
    if (pool && typeof pool.end === "function") {
      await pool.end();
      console.log("✅ Connexion base de données fermée");
    }
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
  // P0-4 fix: Fail-secure si FRONTEND_URL absent en production.
  // En dev/test, on autorise localhost par confort.
  const isProd = process.env.NODE_ENV === "production";
  const frontendUrl = process.env.FRONTEND_URL;

  if (isProd && !frontendUrl) {
    throw new Error("FATAL: FRONTEND_URL est requis en production pour la configuration CORS Socket.IO. Déploiement bloqué.");
  }

  // Réutilise la même logique whitelist que config/cors.js
  const allowedOrigins = [
    ...(isProd
      ? []
      : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"]),
    frontendUrl,
    process.env.ELECTRON_URL,
    "https://madsuite.vercel.app",
    process.env.VERCEL_FRONTEND_URL,
  ].filter(Boolean);

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Non-browser requests: autoriser.
        if (!origin) return callback(null, true);
        const isVercelPreview = origin.endsWith(".vercel.app");
        const isWww = origin === "https://www.madsuite.ca" || origin === "https://madsuite.ca";
        if (!allowedOrigins.includes(origin) && !isVercelPreview && !isWww) {
          return callback(new Error(`Socket.IO CORS refusé pour origine: ${origin}`));
        }
        return callback(null, true);
      },
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

    // 1. Run database migrations (idempotent runner)
    // IMPORTANT: This was previously commented out (risk of new envs, dev/prod drift, hard diagnostics).
    // The runner (runMigrations.js) is designed to be safe:
    // - Uses schema_migration_lock to prevent concurrent runs
    // - Handles baseline snapshot for empty DBs
    // - Skips already-applied migrations
    // - Calls assertRuntimeSchema and selective preflight
    // We now run it on every start for reliability.
    // Escape hatch: SKIP_MIGRATIONS=1
    console.log("📦 Exécution des migrations...");
    if (process.env.SKIP_MIGRATIONS !== "1") {
      await runMigrations({
        backup: process.env.ENABLE_DB_BACKUP === "1",
      });
    } else {
      console.log("⏭️  SKIP_MIGRATIONS=1 → migrations sautées");
    }
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

process.env.NODE_ENV = process.env.NODE_ENV || "development";

// Start the application
start();
