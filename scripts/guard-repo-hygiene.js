const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const ignoredDirs = new Set([".git", "node_modules", "coverage", ".next", ".turbo"]);

const forbiddenPathPatterns = [
  /(^|[\\/])\.env($|\.)/,
  /(^|[\\/])node_modules([\\/]|$)/,
  /(^|[\\/])dist([\\/].*\.(exe|dll|dmg|app|AppImage|msi)$)/i,
  /(^|[\\/])dist([\\/])\.cache([\\/]|$)/i,
];

const secretPatterns = [
  { name: "Stripe live secret", pattern: /sk_live_[A-Za-z0-9]+/ },
  { name: "Stripe test secret", pattern: /sk_test_[A-Za-z0-9]+/ },
  { name: "Stripe webhook secret", pattern: /whsec_[A-Za-z0-9]+/ },
  { name: "Private key", pattern: /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
];

const inspectedExtensions = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".json", ".yml", ".yaml", ".md", ".env", ".example", ".txt",
]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(repoRoot, fullPath);

    for (const pattern of forbiddenPathPatterns) {
      if (pattern.test(relative)) {
        files.push({ path: fullPath, forbiddenPath: true });
        break;
      }
    }

    if (entry.isDirectory()) {
      walk(fullPath, files);
      continue;
    }

    const ext = path.extname(entry.name);
    if (inspectedExtensions.has(ext) || entry.name === ".env.example") {
      files.push({ path: fullPath, forbiddenPath: false });
    }
  }

  return files;
}

const violations = [];

for (const item of walk(repoRoot)) {
  const relative = path.relative(repoRoot, item.path);

  if (item.forbiddenPath) {
    violations.push(`${relative}: forbidden path or generated artifact should not be committed`);
  }

  if (fs.statSync(item.path).isDirectory()) continue;

  const content = fs.readFileSync(item.path, "utf8");
  for (const check of secretPatterns) {
    if (check.pattern.test(content)) {
      violations.push(`${relative}: possible secret detected (${check.name})`);
    }
  }
}

if (violations.length > 0) {
  console.error("\nMADSuite repository hygiene guard failed.\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error("\nRemove generated artifacts/secrets before merging.\n");
  process.exit(1);
}

console.log("Repository hygiene guard passed.");
