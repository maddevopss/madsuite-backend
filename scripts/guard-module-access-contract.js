const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const middlewarePath = path.join(repoRoot, "src", "middleware", "requireModule.js");
const testPath = path.join(repoRoot, "src", "test", "requireModule.test.js");

const violations = [];

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const middleware = read(middlewarePath);
const test = read(testPath);

if (!middleware) {
  violations.push("src/middleware/requireModule.js must exist.");
}

if (middleware && !middleware.includes("MODULES[moduleKey]")) {
  violations.push("requireModule must validate module keys against the central MODULES registry.");
}

if (middleware && !middleware.includes("req.organisationId")) {
  violations.push("requireModule must prefer the canonical req.organisationId context.");
}

if (middleware && !middleware.includes("MODULE_NOT_AVAILABLE")) {
  violations.push("requireModule must return a stable MODULE_NOT_AVAILABLE denial code.");
}

if (!test) {
  violations.push("src/test/requireModule.test.js must exist.");
}

if (test && !test.includes("Unknown MADSuite module")) {
  violations.push("requireModule tests must cover unknown module keys.");
}

if (test && !test.includes("MODULE_NOT_AVAILABLE")) {
  violations.push("requireModule tests must cover stable module denial.");
}

if (violations.length > 0) {
  console.error("\nMADSuite module access contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Module access contract guard passed.");
