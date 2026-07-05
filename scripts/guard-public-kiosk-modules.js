const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const punchPath = path.join(repoRoot, "src", "routes", "punch.routes.js");

const expectations = [
  { marker: "router.get(\"/kiosk/:kiosk_token\"", required: "ensureAnyKioskModule" },
  { marker: "router.post(\"/status\"", required: "ensureKioskModule(res, org, \"kiosk_punch\")" },
  { marker: "router.post(\"/in\"", required: "ensureKioskModule(res, org, \"kiosk_punch\")" },
  { marker: "router.post(\"/out\"", required: "ensureKioskModule(res, org, \"kiosk_punch\")" },
  { marker: "router.post(\"/km\"", required: "ensureKioskModule(res, org, \"kiosk_km\")" },
];

const violations = [];
const source = fs.existsSync(punchPath) ? fs.readFileSync(punchPath, "utf8") : "";

if (!source) {
  violations.push("src/routes/punch.routes.js is missing.");
}

if (source && !source.includes("requireModuleForOrg")) {
  violations.push("punch.routes.js must use requireModuleForOrg for public kiosk module checks.");
}

if (source && !source.includes("MODULE_NOT_AVAILABLE")) {
  violations.push("punch.routes.js must use the stable MODULE_NOT_AVAILABLE code for module denials.");
}

for (const { marker, required } of expectations) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) {
    violations.push(`Missing route marker: ${marker}`);
    continue;
  }

  const nextRouteIndex = source.indexOf("router.", markerIndex + marker.length);
  const routeBlock = source.slice(markerIndex, nextRouteIndex === -1 ? source.length : nextRouteIndex);

  if (!routeBlock.includes(required)) {
    violations.push(`${marker} must include ${required}.`);
  }
}

if (violations.length > 0) {
  console.error("\nMADSuite public kiosk module guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log("Public kiosk module guard passed.");
