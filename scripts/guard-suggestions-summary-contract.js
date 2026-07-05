const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const projectRoutePath = path.join(repoRoot, "src", "routes", "projectDetection.routes.js");
const projectServicePath = path.join(repoRoot, "src", "services", "projectDetection.service.js");
const daySummaryPath = path.join(repoRoot, "src", "routes", "daySummary.routes.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const projectRoute = read(projectRoutePath);
const projectService = read(projectServicePath);
const daySummary = read(daySummaryPath);

if (!app) violations.push("src/app.js is missing.");
if (!projectRoute) violations.push("src/routes/projectDetection.routes.js is missing.");
if (!projectService) violations.push("src/services/projectDetection.service.js is missing.");
if (!daySummary) violations.push("src/routes/daySummary.routes.js is missing.");

if (app && !app.includes('app.use("/api/project-detection", auth, projectDetectionRoutes)')) {
  violations.push("/api/project-detection must be mounted behind auth in app.js.");
}

if (app && !app.includes('app.use("/api/day-summary", auth, daySummaryRoutes)')) {
  violations.push("/api/day-summary must be mounted behind auth in app.js.");
}

if (projectRoute && !projectRoute.includes("requireOrganisation")) {
  violations.push("project detection routes must require organisation context.");
}

if (projectRoute && !projectRoute.includes('requireRole("admin")')) {
  violations.push("project detection pattern/feedback surface must keep admin role guard.");
}

if (projectRoute && !projectRoute.includes("getOrganisationId(req)")) {
  violations.push("project detection routes must use canonical getOrganisationId(req).");
}

if (projectRoute && !projectRoute.includes("z.object")) {
  violations.push("project detection routes must validate payloads with zod.");
}

if (projectService && !projectService.includes("requireOrganisationId(organisationId)")) {
  violations.push("project detection service must require organisationId.");
}

if (projectService && projectService.includes("hasColumn")) {
  violations.push("project detection service must not use schema fallback that can bypass organisation scope.");
}

if (projectService && !projectService.includes("MAX_PROJECT_SUGGESTIONS = 10")) {
  violations.push("project detection suggestions must be capped to 10.");
}

if (projectService && !projectService.includes("MAX_PATTERNS = 500")) {
  violations.push("project detection patterns must be capped.");
}

if (projectService && !projectService.includes("MAX_ACTIVE_PROJECTS = 500")) {
  violations.push("project detection active projects must be capped.");
}

if (projectService && !projectService.includes("WHERE organisation_id = $1")) {
  violations.push("project detection reads must filter by organisation_id.");
}

if (projectService && !projectService.includes("AND organisation_id = $5")) {
  violations.push("activity log suggestion updates must be scoped by organisation_id.");
}

if (projectService && !projectService.includes("ensureProjectInOrganisation")) {
  violations.push("project detection writes must verify project belongs to organisation.");
}

if (daySummary && !daySummary.includes("requireOrganisation")) {
  violations.push("day summary routes must require organisation context.");
}

if (daySummary && !daySummary.includes("getOrganisationId(req)")) {
  violations.push("day summary routes must use canonical getOrganisationId(req).");
}

if (daySummary && !daySummary.includes("MAX_DAY_SUMMARY_ENTRIES = 200")) {
  violations.push("day summary generated entries must be capped to 200.");
}

if (daySummary && !daySummary.includes("MAX_DESCRIPTION_LENGTH = 500")) {
  violations.push("day summary descriptions must be capped.");
}

if (daySummary && !daySummary.includes("LIMIT ${MAX_DAY_SUMMARY_ENTRIES}")) {
  violations.push("day summary SQL must include the entries cap.");
}

if (daySummary && !daySummary.includes("te.utilisateur_id = $1")) {
  violations.push("day summary reads must be scoped to authenticated user.");
}

if (daySummary && !daySummary.includes("te.organisation_id = $3")) {
  violations.push("day summary reads must be scoped to organisation.");
}

if (daySummary && !daySummary.includes("ON CONFLICT (organisation_id, utilisateur_id, summary_date)")) {
  violations.push("day summary updates must conflict on organisation + user + date.");
}

if (violations.length > 0) {
  console.error("\nMADSuite suggestions/day-summary contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Suggestions/day-summary contract guard passed.");
