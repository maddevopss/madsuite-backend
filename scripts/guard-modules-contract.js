const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const routeFile = path.join(repoRoot, "src", "routes", "modules.routes.js");
const serviceFile = path.join(repoRoot, "src", "services", "modules.service.js");

const violations = [];

if (!fs.existsSync(serviceFile)) {
  violations.push("src/services/modules.service.js is missing. The modules API payload must be built by a dedicated service.");
}

if (!fs.existsSync(routeFile)) {
  violations.push("src/routes/modules.routes.js is missing.");
} else {
  const source = fs.readFileSync(routeFile, "utf8");

  if (!source.includes("buildModulesPayload")) {
    violations.push("src/routes/modules.routes.js must call buildModulesPayload() instead of building the modules payload inline.");
  }

  const forbiddenRoutePatterns = [
    /Object\.entries\(MODULES\)\.map/,
    /matrix_status:\s*config\.matrix_status/,
    /included_in_plan:\s*includedInPlan/,
    /is_addon_active:\s*!includedInPlan\s*&&\s*explicitlyEnabled/,
  ];

  for (const pattern of forbiddenRoutePatterns) {
    if (pattern.test(source)) {
      violations.push(`src/routes/modules.routes.js contains inline modules contract logic matching ${pattern}. Move it to src/services/modules.service.js.`);
    }
  }
}

if (fs.existsSync(serviceFile)) {
  const service = fs.readFileSync(serviceFile, "utf8");
  const requiredExports = [
    "normalizeEnabledMap",
    "normalizePricingMap",
    "buildModuleDto",
    "buildModulesPayload",
  ];

  for (const exportName of requiredExports) {
    if (!service.includes(exportName)) {
      violations.push(`src/services/modules.service.js must expose ${exportName}.`);
    }
  }
}

if (violations.length > 0) {
  console.error("\nMADSuite modules contract guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  console.error("\nKeep route orchestration separate from modules API contract construction.\n");
  process.exit(1);
}

console.log("Modules contract guard passed.");
