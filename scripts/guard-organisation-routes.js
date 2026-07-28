const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const routesRoot = path.join(repoRoot, "src", "routes");
const violations = [];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(absolute);
    return entry.isFile() && entry.name.endsWith(".js") ? [absolute] : [];
  });
}

function hasOrganisationMiddleware(source) {
  return (
    source.includes("requireOrganisation") &&
    /router\.use\(\s*requireOrganisation\s*\)/s.test(source)
  );
}

function extractQueries(source) {
  const queries = [];
  const matcher = /(?:req\.db|pool)\.query\s*\(/g;
  let match;

  while ((match = matcher.exec(source)) !== null) {
    let start = matcher.lastIndex;
    while (/\s/.test(source[start] || "")) start += 1;

    const quote = source[start];
    if (!["`", "'", '"'].includes(quote)) {
      queries.push({ sql: null, offset: match.index });
      continue;
    }

    let index = start + 1;
    let escaped = false;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) break;
    }

    if (index >= source.length) {
      queries.push({ sql: null, offset: match.index });
      break;
    }

    const sql = source.slice(start + 1, index);
    queries.push({ sql: quote === "`" && sql.includes("${") ? null : sql, offset: match.index });
    matcher.lastIndex = index + 1;
  }

  return queries;
}

function insertHasOrganisationScope(sql) {
  const match = sql.match(/\binsert\s+into\s+[\w."-]+\s*\(([^)]+)\)\s*values\s*\(([^)]+)\)/is);
  if (!match) return false;

  const columns = match[1].split(",").map((value) => value.trim().replaceAll('"', ""));
  const values = match[2].split(",").map((value) => value.trim());
  const organisationIndex = columns.findIndex((column) => column === "organisation_id");

  return organisationIndex >= 0 && /^\$\d+$/.test(values[organisationIndex] || "");
}

function queryHasOrganisationScope(sql) {
  if (!sql) return false;

  const normalized = sql.replace(/\s+/g, " ").trim();
  if (/^insert\b/i.test(normalized)) return insertHasOrganisationScope(normalized);

  return /\bwhere\b[\s\S]*?(?:\b\w+\.)?organisation_id\s*=\s*\$\d+\b/i.test(normalized);
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split(/\r?\n/).length;
}

if (!fs.existsSync(routesRoot)) {
  console.error(`Routes directory missing: ${path.relative(repoRoot, routesRoot)}`);
  process.exit(1);
}

for (const file of walk(routesRoot)) {
  const source = fs.readFileSync(file, "utf8");
  const queries = extractQueries(source);
  if (queries.length === 0) continue;

  const organisationScoped =
    source.includes("organisation_id") ||
    source.includes("organisationId") ||
    source.includes("organisationValue") ||
    source.includes("requireOrganisation");

  // Les routeurs réellement globaux (authentification, santé, plateforme) ne sont
  // pas transformés artificiellement en routeurs multi-organisationnels.
  if (!organisationScoped || hasOrganisationMiddleware(source)) continue;

  const relativeFile = path.relative(repoRoot, file).replaceAll(path.sep, "/");
  for (const query of queries) {
    if (!queryHasOrganisationScope(query.sql)) {
      violations.push(
        `${relativeFile}:${lineNumber(source, query.offset)} doit appliquer requireOrganisation ` +
          "ou filtrer explicitement la requête par organisation_id avec un paramètre positionnel",
      );
    }
  }
}

if (violations.length > 0) {
  console.error("\nMADSuite organisation route guard failed.\n");
  violations.forEach((violation) => console.error(`- ${violation}`));
  console.error("\nChaque accès DB d'un routeur organisationnel doit être protégé par le middleware canonique ou par un scoping SQL explicite.\n");
  process.exit(1);
}

console.log("Organisation route guard passed.");
