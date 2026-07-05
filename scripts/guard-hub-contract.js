const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const serverPath = path.join(repoRoot, "server.js");
const routePath = path.join(repoRoot, "src", "routes", "hub.routes.js");
const socketPath = path.join(repoRoot, "src", "socket", "hub.socket.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const app = read(appPath);
const server = read(serverPath);
const route = read(routePath);
const socket = read(socketPath);

if (!app) violations.push("src/app.js is missing.");
if (!server) violations.push("server.js is missing.");
if (!route) violations.push("src/routes/hub.routes.js is missing.");
if (!socket) violations.push("src/socket/hub.socket.js is missing.");

if (app && !app.includes('app.use("/api/hub", auth, hubRoutes)')) {
  violations.push("/api/hub must be mounted behind auth in app.js.");
}

if (server && !server.includes('require("./src/socket/hub.socket")(io)')) {
  violations.push("server.js must initialize the Hub socket handler.");
}

if (server && !server.includes("allowedOriginsSet.has(origin)")) {
  violations.push("Socket.IO CORS must use strict allowed origins.");
}

if (route && !route.includes("requireOrganisation")) {
  violations.push("Hub routes must require organisation context.");
}

if (route && !route.includes("getOrganisationId(req)")) {
  violations.push("Hub routes must use canonical getOrganisationId(req).");
}

if (route && route.includes("req.user.organisation_id")) {
  violations.push("Hub routes must not use req.user.organisation_id directly.");
}

if (route && route.includes("io.emit(")) {
  violations.push("Hub routes must not use global io.emit.");
}

if (route && !route.includes(".of('/hub').to(`org_${orgId}`).emit")) {
  violations.push("Hub route broadcasts must target /hub org rooms.");
}

if (socket && !socket.includes('io.of("/hub")')) {
  violations.push("Hub socket must use the /hub namespace.");
}

if (socket && !socket.includes("jwt.verify(token, process.env.JWT_SECRET")) {
  violations.push("Hub socket must verify JWT with JWT_SECRET.");
}

if (socket && !socket.includes('algorithms: ["HS256"]')) {
  violations.push("Hub socket JWT verification must pin HS256.");
}

if (socket && !socket.includes("decoded.token_type === \"refresh\"")) {
  violations.push("Hub socket must reject refresh tokens.");
}

if (socket && !socket.includes("org_${user.organisation_id}")) {
  violations.push("Hub socket must join organisation room using organisation_id.");
}

if (socket && socket.includes("socket.handshake.headers.cookie" ) && socket.includes("console")) {
  violations.push("Hub socket must not log raw cookies.");
}

if (socket && !socket.includes("MAX_SOCKET_PAYLOAD_BYTES = 4096")) {
  violations.push("Hub socket must cap relay payload size.");
}

if (socket && !socket.includes("TIMER_RELAY_FIELDS")) {
  violations.push("Hub socket timer update payload must be allowlisted.");
}

if (socket && !socket.includes("ALLOWED_TIMER_COMMANDS")) {
  violations.push("Hub socket timer commands must be allowlisted.");
}

if (socket && !socket.includes("sanitizeTimerUpdatePayload")) {
  violations.push("Hub socket timer updates must be sanitized before relay.");
}

if (socket && !socket.includes("sanitizeTimerCommandPayload")) {
  violations.push("Hub socket timer commands must be sanitized before relay.");
}

if (socket && socket.includes("socket.to(orgRoom).emit(\"hub:timer:sync\", payload)")) {
  violations.push("Hub socket must not relay raw timer update payloads.");
}

if (socket && socket.includes("socket.to(orgRoom).emit(\"hub:timer:command\", payload)")) {
  violations.push("Hub socket must not relay raw timer command payloads.");
}

if (violations.length > 0) {
  console.error("\nMADSuite Hub contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Hub contract guard passed.");
