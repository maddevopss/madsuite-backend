const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "routes", "calendar.routes.js");
const parserPath = path.join(repoRoot, "src", "utils", "icalParser.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);
const parser = read(parserPath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/routes/calendar.routes.js is missing.");
if (!parser) violations.push("src/utils/icalParser.js is missing.");

if (app && !app.includes('app.use("/api/calendar", auth, require("./routes/calendar.routes"))')) {
  violations.push("/api/calendar must be mounted behind auth in app.js.");
}

if (route && !route.includes("requireOrganisation")) {
  violations.push("calendar routes must require organisation context.");
}

if (route && !route.includes("getOrganisationId(req)")) {
  violations.push("calendar routes must use canonical getOrganisationId(req).");
}

if (route && route.includes("req.user.organisation_id || req.organisationId")) {
  violations.push("calendar routes must not use fallback organisation scope.");
}

if (route && !route.includes("validateICalUrl")) {
  violations.push("calendar feed URL must be validated before persistence.");
}

if (route && !route.includes("CALENDAR_INVALID_URL")) {
  violations.push("calendar route must return a stable invalid URL error code.");
}

if (route && !route.includes(".slice(0, 100)")) {
  violations.push("calendar event responses must be bounded to 100 events.");
}

if (parser && !parser.includes("validateICalUrl")) {
  violations.push("icalParser must export validateICalUrl.");
}

if (parser && !parser.includes("MAX_ICAL_BYTES = 1024 * 1024")) {
  violations.push("iCal fetch must keep a 1 MB content cap.");
}

if (parser && !parser.includes("ICAL_TIMEOUT_MS = 10000")) {
  violations.push("iCal fetch must keep a 10-second timeout.");
}

if (parser && !parser.includes("PRIVATE_HOST_PATTERNS")) {
  violations.push("iCal URL validation must block private/local host patterns.");
}

if (parser && !parser.includes("['https:', 'http:']")) {
  violations.push("iCal URL validation must only allow HTTP/HTTPS protocols.");
}

if (parser && parser.includes("axios.get(url)")) {
  violations.push("iCal fetch must not call axios.get on raw URL.");
}

if (parser && parser.includes("console.error")) {
  violations.push("iCal parser must not use console.error for external fetch failures.");
}

if (parser && !parser.includes("logger.warn('Erreur iCal'")) {
  violations.push("iCal parser must log external fetch failures through logger.warn.");
}

if (parser && !parser.includes("lines = data.split")) {
  violations.push("iCal parser must parse textual calendar data.");
}

if (parser && !parser.includes(".slice(0, 50000)")) {
  violations.push("iCal parser must bound parsed line count.");
}

if (violations.length > 0) {
  console.error("\nMADSuite calendar contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Calendar contract guard passed.");
