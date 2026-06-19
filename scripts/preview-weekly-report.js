const fs = require("fs");
const path = require("path");
const { generateWeeklyReportHtml } = require("../src/jobs/weeklyReport");

/**
 * Script utilitaire pour prévisualiser le rendu HTML de l'email
 * sans l'envoyer.
 */
function preview() {
  const orgName = "Ma Super Entreprise";
  const totalHours = 145;
  const purgeStats = {
    logsCount: 1250,
    softDeleteCount: 42,
  };

  const html = generateWeeklyReportHtml(orgName, totalHours, purgeStats);
  const outputPath = path.join(__dirname, "weekly-report-preview.html");

  fs.writeFileSync(outputPath, html);
  console.log(`✅ Aperçu généré avec succès !`);
  console.log(`👉 Ouvre ce fichier dans ton navigateur : ${outputPath}`);
}

preview();
