// Étage 7 (#175) PR G — déploiement progressif et retour arrière.
//
// Constat : aucune migration existante (db/migrations/*.sql) n'exécute de
// DROP TABLE ni DROP COLUMN — la discipline "additive seulement, jamais de
// suppression destructrice" est déjà suivie en pratique, ce qui EST la
// stratégie compensatoire de rollback de ce repo (une migration additive
// peut toujours être laissée en place sans danger si le déploiement qui la
// consomme est retourné en arrière ; une migration destructrice, non).
//
// Ce garde-fou rend cette propriété structurelle plutôt qu'accidentelle :
// toute nouvelle migration contenant DROP TABLE / DROP COLUMN fait échouer
// la CI, sauf reconnaissance explicite et délibérée via un commentaire
// `-- ROLLBACK-ACKNOWLEDGED: <justification>` dans le même fichier — une
// décision consciente, pas un oubli qui casse le retour arrière en silence.

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const migrationsDirs = [path.join(repoRoot, "db", "migrations"), path.join(repoRoot, "db", "archive", "migrations")];

const DESTRUCTIVE_PATTERN = /\bDROP\s+(TABLE|COLUMN)\b/i;
const ACK_PATTERN = /--\s*ROLLBACK-ACKNOWLEDGED\s*:\s*\S/i;

function listSqlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => path.join(dir, entry.name));
}

// Retire les commentaires SQL en ligne (-- ...) avant de chercher un DROP
// destructeur : un DROP TABLE laissé en commentaire (note de développeur,
// jamais exécuté) ne doit pas déclencher le garde-fou.
function stripSqlLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const violations = [];

for (const dir of migrationsDirs) {
  for (const file of listSqlFiles(dir)) {
    const content = fs.readFileSync(file, "utf8");
    const executable = stripSqlLineComments(content);
    if (DESTRUCTIVE_PATTERN.test(executable) && !ACK_PATTERN.test(content)) {
      violations.push(path.relative(repoRoot, file));
    }
  }
}

if (violations.length > 0) {
  console.error("MADSuite migration reversibility guard failed.\n");
  console.error("Migrations avec DROP TABLE/DROP COLUMN sans reconnaissance explicite :\n");
  violations.forEach((file) => console.error(`- ${file}`));
  console.error(
    "\nUne migration destructrice casse le retour arrière (le déploiement précédent ne peut plus lire la colonne/table). " +
      "Ajoutez un commentaire `-- ROLLBACK-ACKNOWLEDGED: <justification>` dans le fichier si c'est un choix délibéré, " +
      "ou préférez une migration additive (déprécier plutôt que supprimer).\n",
  );
  process.exit(1);
}

console.log("Garde-fou de réversibilité des migrations : aucune suppression destructrice non reconnue.");
