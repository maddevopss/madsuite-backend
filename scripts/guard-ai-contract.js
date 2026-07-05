const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const routePath = path.join(repoRoot, "src", "routes", "aiAssistant.routes.js");
const servicePath = path.join(repoRoot, "src", "services", "ai.service.js");
const toolsPath = path.join(repoRoot, "src", "services", "aiTools.service.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const route = read(routePath);
const service = read(servicePath);
const tools = read(toolsPath);

if (!app) violations.push("src/app.js is missing.");
if (!route) violations.push("src/routes/aiAssistant.routes.js is missing.");
if (!service) violations.push("src/services/ai.service.js is missing.");
if (!tools) violations.push("src/services/aiTools.service.js is missing.");

if (app && !app.includes('app.use("/api/ai-assistant", auth, aiAssistantRoutes)')) {
  violations.push("/api/ai-assistant must be mounted behind auth in app.js.");
}

if (route && !route.includes("requireOrganisation")) {
  violations.push("AI assistant route must apply requireOrganisation.");
}

if (route && !route.includes("getOrganisationId(req)")) {
  violations.push("AI assistant route must use canonical getOrganisationId(req).");
}

if (route && !route.includes("rateLimit")) {
  violations.push("AI assistant route must use a dedicated rate limiter.");
}

if (route && !route.includes("max: isDev ? 200 : 20")) {
  violations.push("AI assistant production rate limit must remain 20 requests/minute per organisation.");
}

if (route && !route.includes('new Set(["user", "assistant"])')) {
  violations.push("AI assistant must only accept user and assistant roles from clients.");
}

if (route && !route.includes("MAX_MESSAGES = 20")) {
  violations.push("AI assistant must cap client message history to 20 messages.");
}

if (route && !route.includes("MAX_MESSAGE_LENGTH = 2000")) {
  violations.push("AI assistant must cap individual message length to 2000 characters.");
}

if (route && !route.includes("SERVICE_UNAVAILABLE")) {
  violations.push("AI assistant must return SERVICE_UNAVAILABLE when OpenAI is not configured.");
}

if (service && !service.includes("ne pose pas de diagnostic")) {
  violations.push("AI system prompt must keep non-medical / no diagnosis language.");
}

if (service && !service.includes("max_tokens: 1000")) {
  violations.push("AI assistant calls must keep max_tokens capped.");
}

if (service && !service.includes("timeout: 30000")) {
  violations.push("AI assistant initial call must keep a timeout.");
}

if (service && !service.includes("let maxIterations = 5")) {
  violations.push("AI tool-call loop must remain capped at 5 iterations.");
}

if (service && !service.includes("executeToolCall(toolCall, organisationId)")) {
  violations.push("AI tools must execute with organisationId scope.");
}

if (tools && !tools.includes("organisationId")) {
  violations.push("AI tools service must keep organisationId-aware execution.");
}

if (violations.length > 0) {
  console.error("\nMADSuite AI contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("AI contract guard passed.");
