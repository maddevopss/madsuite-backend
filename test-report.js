// test-report.js
require("dotenv").config();
const { sendWeeklyReport } = require("./src/jobs/weeklyReport");

console.log("🚀 Lancement manuel du rapport...");
sendWeeklyReport()
  .then(() => {
    console.log("✅ Terminé");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Échec:", err);
    process.exit(1);
  });
