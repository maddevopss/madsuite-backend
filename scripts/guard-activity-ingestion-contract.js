const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const activityRoutesPath = path.join(repoRoot, "src", "routes", "activity.js");
const writeRoutesPath = path.join(repoRoot, "src", "routes", "activity.write.routes.js");
const servicePath = path.join(repoRoot, "src", "services", "activity.service.js");
const validatorPath = path.join(repoRoot, "src", "validators", "activity.validator.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const activityRoutes = read(activityRoutesPath);
const writeRoutes = read(writeRoutesPath);
const service = read(servicePath);
const validator = read(validatorPath);

if (!app) violations.push("src/app.js is missing.");
if (!activityRoutes) violations.push("src/routes/activity.js is missing.");
if (!writeRoutes) violations.push("src/routes/activity.write.routes.js is missing.");
if (!service) violations.push("src/services/activity.service.js is missing.");
if (!validator) violations.push("src/validators/activity.validator.js is missing.");

if (app && !app.includes("activityLimiter")) {
  violations.push("/api/activity must use the activityLimiter path in app.js.");
}

if (activityRoutes && !activityRoutes.includes("requireOrganisation")) {
  violations.push("activity.js must apply requireOrganisation before read/write routes.");
}

if (writeRoutes && !writeRoutes.includes("batchEventsSchema.safeParse(req.body)")) {
  violations.push("POST /activity/batch must validate req.body with batchEventsSchema.");
}

if (writeRoutes && !writeRoutes.includes("createActivitySchema.safeParse")) {
  violations.push("Activity writes must validate create activity payloads.");
}

if (writeRoutes && !writeRoutes.includes("createWindowLogsSchema.safeParse")) {
  violations.push("Window activity writes must validate window payloads.");
}

if (writeRoutes && !writeRoutes.includes("updateActivityDurationSchema.safeParse")) {
  violations.push("Duration updates must validate patch payloads.");
}

if (writeRoutes && !writeRoutes.includes("getOrganisationId(req)")) {
  violations.push("Activity write routes must pass getOrganisationId(req) to the service.");
}

if (service && !service.includes("sanitizeAppName")) {
  violations.push("activity.service.js must sanitize app names before insert.");
}

if (service && !service.includes("sanitizeWindowTitle")) {
  violations.push("activity.service.js must sanitize window titles before insert.");
}

if (service && !service.includes("MAX_BACKGROUND_WINDOWS = 25")) {
  violations.push("Background window ingestion must keep the MAX_BACKGROUND_WINDOWS cap.");
}

if (service && !service.includes("ON CONFLICT (idempotency_key) DO NOTHING")) {
  violations.push("Batch active log ingestion must remain idempotent on idempotency_key.");
}

if (service && !service.includes("getActivityOrganisationCondition")) {
  violations.push("activity.service.js must keep organisation-scoped query conditions.");
}

if (service && !service.includes("AND utilisateur_id = $5")) {
  violations.push("Activity duration updates must be scoped by user id.");
}

if (validator && !validator.includes("batchEventsSchema")) {
  violations.push("activity.validator.js must expose batchEventsSchema.");
}

if (violations.length > 0) {
  console.error("\nMADSuite activity ingestion contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Activity ingestion contract guard passed.");
