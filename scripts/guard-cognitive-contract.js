const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "routes", "cognitive.routes.js");
const controllerPath = path.join(repoRoot, "src", "api", "controllers", "event.controller.js");
const enginePath = path.join(repoRoot, "src", "core", "stateEngine", "cognitiveStateEngine.js");
const processorPath = path.join(repoRoot, "src", "core", "eventProcessor", "eventProcessor.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);
const controller = read(controllerPath);
const engine = read(enginePath);
const processor = read(processorPath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/routes/cognitive.routes.js is missing.");
if (!controller) violations.push("src/api/controllers/event.controller.js is missing.");
if (!engine) violations.push("src/core/stateEngine/cognitiveStateEngine.js is missing.");
if (!processor) violations.push("src/core/eventProcessor/eventProcessor.js is missing.");

if (app && !app.includes('app.use("/api/cognitive", auth, cognitiveRoutes)')) {
  violations.push("/api/cognitive must be mounted behind auth in app.js.");
}

if (route && !route.includes("requireOrganisation")) {
  violations.push("cognitive routes must require organisation context.");
}

if (controller && !controller.includes("getOrganisationId(req)")) {
  violations.push("cognitive controller must use canonical getOrganisationId(req).");
}

if (controller && !controller.includes("REQUIRED_EVENT_FIELDS")) {
  violations.push("cognitive event ingestion must declare required fields.");
}

if (controller && !controller.includes("buildSafeCognitivePayload")) {
  violations.push("cognitive event ingestion must sanitize/whitelist payloads.");
}

if (controller && !controller.includes("sessionDuration > 1440")) {
  violations.push("cognitive event ingestion must keep a sane sessionDuration upper bound.");
}

if (controller && !controller.includes("contextSwitches > 1000")) {
  violations.push("cognitive event ingestion must keep a sane contextSwitches upper bound.");
}

if (controller && !controller.includes("uiInteractions > 100000")) {
  violations.push("cognitive event ingestion must keep a sane uiInteractions upper bound.");
}

if (controller && controller.includes("processEvent(userId, orgId, req.body)")) {
  violations.push("cognitive event ingestion must not pass raw req.body into the processor.");
}

if (controller && controller.includes("const orgId = req.user.organisation_id")) {
  violations.push("cognitive controller must not use req.user.organisation_id directly.");
}

if (engine && !engine.includes("['flow', 'deep_focus', 'friction', 'fatigue']")) {
  violations.push("cognitive engine must keep the official V1 state set.");
}

if (engine && !engine.includes("MUST be pure and deterministic")) {
  violations.push("cognitive engine must remain documented as pure and deterministic.");
}

if (processor && !processor.includes("historyService.appendEvent")) {
  violations.push("cognitive processor must persist through historyService.appendEvent.");
}

if (processor && !processor.includes("computedState.state")) {
  violations.push("cognitive processor must persist the computed state, not a client state.");
}

if (violations.length > 0) {
  console.error("\nMADSuite cognitive contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Cognitive contract guard passed.");
