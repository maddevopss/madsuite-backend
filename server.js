const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, process.env.NODE_ENV === "test" ? ".env.test" : ".env"),
  override: false,
});

function parseSampleRate(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function splitOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function shouldRunMigrationsOnStartup() {
  if (process.env.SKIP_MIGRATIONS === "1") return false;
  if (process.env.RUN_MIGRATIONS_ON_STARTUP === "1") return true;
  return process.env.NODE_ENV !== "production";
}

// INITIALISATION DE SENTRY
const Sentry = require("@sentry/node");
const { nodeProfilingIntegration } = require("@sentry/profiling-node");

if (process.env.SENTRY_DSN) {
  const isProd = process.env.NODE_ENV === "production";

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE, isProd ? 0.1 : 1.0),
    profilesSampleRate: parseSampleRate(process.env.SENTRY_PROFILES_SAMPLE_RATE, isProd ? 0.05 : 1.0),
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

  // Réutilise la même logique whitelist stricte que config/cors.js.
  // En production, aucun wildcard *.vercel.app n'est accepté.
  const allowedOrigins = [
    ...(isProd
      ? []
      : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"]),
    frontendUrl,
    process.env.ELECTRON_URL,
    "https://madsuite.ca",
    "https://www.madsuite.ca",
    "https://madsuite.vercel.app",
    process.env.VERCEL_FRONTEND_URL,
    ...splitOrigins(process.env.ALLOWED_CORS_ORIGINS),
  ].filter(Boolean);
  const allowedOriginsSet = new Set(allowedOrigins);

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        // Non-browser requests: autoriser.
        if (!origin) return callback(null, true);
        if (!allowedOriginsSet.has(origin)) {
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

    // 1. Run database migrations.
    // Dev/test keep automatic migrations by default for local reliability.
    // Production must run migrations as an explicit deploy step with npm run db:migrate,
    // or opt in with RUN_MIGRATIONS_ON_STARTUP=1 for platforms that require startup migrations.
    if (shouldRunMigrationsOnStartup()) {
      console.log("📦 Exécution des migrations...");
      await runMigrations({
        backup: process.env.ENABLE_DB_BACKUP === "1",
      });
      console.log("✅ Migrations terminées");
    } else {
      console.log("⏭️  Migrations de démarrage désactivées");
    }

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
