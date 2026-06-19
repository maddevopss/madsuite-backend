// Validation stricte des variables d'environnement requises.
// Objectif: echouer tot avec des messages clairs, sans exposer de secrets.

const requiredEnvVars = ["NODE_ENV", "JWT_SECRET"];

function fail(message) {
  console.error(`ENV: ${message}`);
  console.error("Backend: verifier backend/.env.example");
  process.exit(1);
}

function validateJwtSecret(secret) {
  const value = String(secret || "");
  const normalized = value.toLowerCase().trim();
  const forbiddenSecrets = new Set([
    "change_me",
    "changeme",
    "secret",
    "jwt_secret",
    "password",
    "test-secret",
    "development",
    "production",
  ]);

  if (value.length < 32) {
    fail("JWT_SECRET trop court (minimum: 32 caracteres)");
  }

  if (forbiddenSecrets.has(normalized)) {
    fail("JWT_SECRET ne doit pas etre une valeur generique ou de dictionnaire");
  }

  const characterClasses = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((pattern) => pattern.test(value)).length;

  if (characterClasses < 3) {
    fail("JWT_SECRET doit melanger au moins 3 types de caracteres");
  }
}

function validatePositiveInt(name, value) {
  if (value === undefined || value === "") return;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    fail(`${name} invalide (attendu entier > 0): ${value}`);
  }
}

function validateEnv() {
  const missing = requiredEnvVars.filter((envVar) => {
    const value = process.env[envVar];
    return value === undefined || value === "";
  });

  const hasDbUrl = process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL !== "";
  const dbVars = ["DB_USER", "DB_HOST", "DB_NAME", "DB_PASSWORD", "DB_PORT"];
  const missingDbVars = dbVars.filter(envVar => process.env[envVar] === undefined || process.env[envVar] === "");

  if (!hasDbUrl && missingDbVars.length > 0) {
    missing.push(...missingDbVars);
  }

  if (missing.length > 0) {
    fail(`variables manquantes: ${missing.join(", ")}`);
  }

  if (!hasDbUrl && process.env.DB_PORT) {
    const parsedPort = Number(process.env.DB_PORT);
    if (!Number.isInteger(parsedPort) || parsedPort <= 0) {
      fail(`DB_PORT invalide (attendu entier > 0): ${process.env.DB_PORT}`);
    }
  }

  const nodeEnv = String(process.env.NODE_ENV).toLowerCase();
  if (!["development", "test", "production"].includes(nodeEnv)) {
    fail(`NODE_ENV invalide (development|test|production): ${process.env.NODE_ENV}`);
  }

  validateJwtSecret(process.env.JWT_SECRET);

  // Validation des nouvelles variables optionnelles ou techniques
  validatePositiveInt("DB_MAX_POOL_SIZE", process.env.DB_MAX_POOL_SIZE);
  validatePositiveInt("DB_CONNECTION_TIMEOUT_MS", process.env.DB_CONNECTION_TIMEOUT_MS);
  validatePositiveInt("LONG_TIMER_THRESHOLD_HOURS", process.env.LONG_TIMER_THRESHOLD_HOURS);
  validatePositiveInt("ACTIVITY_LOG_RETENTION_DAYS", process.env.ACTIVITY_LOG_RETENTION_DAYS);

  console.log("ENV validees");
}

module.exports = validateEnv;
