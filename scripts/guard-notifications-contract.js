const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "routes", "notifications.routes.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/routes/notifications.routes.js is missing.");

if (app && !app.includes('app.use("/api/notifications", auth, notificationsRoutes)')) {
  violations.push("/api/notifications must be mounted behind auth in app.js.");
}

if (route && !route.includes("requireOrganisation")) {
  violations.push("notifications routes must require organisation context.");
}

if (route && !route.includes("getOrganisationId(req)")) {
  violations.push("notifications routes must use canonical getOrganisationId(req).");
}

if (route && !route.includes("const userId = req.user.id")) {
  violations.push("notifications routes must scope reads/updates to the authenticated user id.");
}

if (route && !route.includes("WHERE organisation_id = $1 AND utilisateur_id = $2")) {
  violations.push("notification list query must filter by organisation_id and utilisateur_id.");
}

if (route && !route.includes("LIMIT 50")) {
  violations.push("notification list query must keep a bounded LIMIT.");
}

if (route && !route.includes("UPDATE notifications SET is_read = TRUE")) {
  violations.push("notification read endpoint must only mark notifications read.");
}

if (route && !route.includes("WHERE id = $1 AND organisation_id = $2 AND utilisateur_id = $3")) {
  violations.push("notification read update must be scoped by id, organisation_id, and utilisateur_id.");
}

if (route && route.includes("DELETE FROM notifications")) {
  violations.push("notifications route must not delete notifications without an explicit contract.");
}

if (route && route.includes("SELECT * FROM notifications") && !route.includes("LIMIT 50")) {
  violations.push("notifications route must not expose unbounded SELECT * reads.");
}

if (violations.length > 0) {
  console.error("\nMADSuite notifications contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Notifications contract guard passed.");
