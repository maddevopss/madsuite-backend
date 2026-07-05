const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const gitignorePath = path.join(repoRoot, ".gitignore");
const content = fs.readFileSync(gitignorePath, "utf8");

const requiredRules = [
  "node_modules/",
  "dist/",
  "build/",
  ".env",
  ".env.*",
  "!.env.example",
  "coverage/",
  "*.log",
];

const missing = requiredRules.filter((rule) => !content.split(/\r?\n/).includes(rule));

if (missing.length > 0) {
  console.error("\nMADSuite backend .gitignore policy failed.\n");
  missing.forEach((rule) => console.error(`- missing: ${rule}`));
  process.exit(1);
}

console.log("Backend .gitignore policy passed.");
