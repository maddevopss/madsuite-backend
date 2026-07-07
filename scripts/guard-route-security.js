const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const appPath = path.join(repoRoot, "src", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

const routeExpectations = [
  {
    route: "/api/organisation",
    required: ["auth"],
    rationale: "organisation customer surface must never be mounted anonymously",
  },
  {
    route: "/api/organisations",
    required: ["auth"],
    routerFile: path.join(repoRoot, "src", "routes", "organisations.routes.js"),
    routerRequired: ["requireSuperAdmin"],
    rationale: "platform organisations management is super-admin only",
  },
  {
    route: "/api/organisation/modules",
    required: ["auth"],
    rationale: "module subscription surface must never be mounted anonymously",
  },
  {
    route: "/api/hub",
    required: ["auth"],
    routerFile: path.join(repoRoot, "src", "routes", "hub.routes.js"),
    routerRequired: ["requireOrganisation"],
    rationale: "hub data must use request-scoped organisation/RLS context",
  },
  {
    route: "/api/master-admin",
    required: ["auth"],
    routerFile: path.join(repoRoot, "src", "routes", "master-admin.routes.js"),
    routerRequired: ["requireSuperAdmin"],
    rationale: "master-admin surface is platform-super-admin only",
  },
  {
    route: "/api/system",
    required: ["auth"],
    routerFile: path.join(repoRoot, "src", "routes", "system.routes.js"),
    routerRequired: ["requireSuperAdmin"],
    rationale: "system health/cron data is global platform data",
  },
  {
    route: "/api/analytics",
    required: ["auth"],
    routerFile: path.join(repoRoot, "src", "routes", "analytics.routes.js"),
    routerRequired: ["requireSuperAdmin"],
    rationale: "analytics funnel and revenue truth snapshots are platform data",
  },
];

function findAppUseCall(route) {
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`app\\.use\\(\\s*["']${escapedRoute}["'](?<args>[\\s\\S]*?)\\);`, "m");
  return pattern.exec(appSource);
}

function assertAppUseHas(route, required, violations, rationale) {
  const match = findAppUseCall(route);
  if (!match) {
    violations.push(`${route}: route mount not found (${rationale})`);
    return;
  }

  const args = match.groups?.args || "";
  for (const token of required) {
    const tokenPattern = new RegExp(`(?:^|[,\\s])${token}(?:[,\\s]|$)`);
    if (!tokenPattern.test(args)) {
      violations.push(`${route}: missing ${token} in app.js mount (${rationale})`);
    }
  }
}

function assertRouterHas(file, required, route, violations, rationale) {
  if (!file) return;
  if (!fs.existsSync(file)) {
    violations.push(`${route}: router file missing: ${path.relative(repoRoot, file)} (${rationale})`);
    return;
  }

  const source = fs.readFileSync(file, "utf8");
  for (const token of required || []) {
    if (!source.includes(token)) {
      violations.push(`${route}: router ${path.relative(repoRoot, file)} missing ${token} (${rationale})`);
    }
  }
}

const violations = [];

for (const expectation of routeExpectations) {
  assertAppUseHas(expectation.route, expectation.required, violations, expectation.rationale);
  assertRouterHas(
    expectation.routerFile,
    expectation.routerRequired,
    expectation.route,
    violations,
    expectation.rationale,
  );
}

if (violations.length > 0) {
  console.error("\nMADSuite backend route security guard failed.\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error("\nFix route mounts/routers before merging.\n");
  process.exit(1);
}

console.log("Backend route security guard passed.");
