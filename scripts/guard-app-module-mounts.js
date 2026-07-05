const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");

const expectedMounts = [
  { route: "/api/reports", module: "reports" },
  { route: "/api/activity-intelligence", module: "activity_intelligence" },
  { route: "/api/billing-assistant", module: "billing_assistant" },
  { route: "/api/invoices", module: "invoices" },
  { route: "/api/billing", module: "invoices" },
  { route: "/api/revenue", module: "invoices" },
  { route: "/api/estimates", module: "estimates" },
  { route: "/api/quotes", module: "quotes" },
  { route: "/api/expenses", module: "expenses" },
];

const violations = [];
const source = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";

if (!source) {
  violations.push("src/app.js is missing.");
}

if (source && !source.includes("const { requireModule } = require(\"./middleware/requireModule\")")) {
  violations.push("src/app.js must import requireModule from ./middleware/requireModule.");
}

for (const { route, module } of expectedMounts) {
  const routeRegex = route.replace(/\//g, "\\/");
  const expected = new RegExp(`app\\.use\\(\\s*["']${routeRegex}["'][\\s\\S]*?requireModule\\(\\s*["']${module}["']\\s*\\)`);

  if (!expected.test(source)) {
    violations.push(`${route} must be mounted with requireModule("${module}").`);
  }
}

if (violations.length > 0) {
  console.error("\nMADSuite app module mounts guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  console.error("\nKeep protected API mounts aligned with SYSTEME_MAD/09-CHECKLISTS/chk-052-p3-plans-modules-subscriptions.md.\n");
  process.exit(1);
}

console.log("App module mounts guard passed.");
