require('dotenv').config();
const { runMigrations } = require('./src/migrate/runMigrations');
const { processReminders } = require('./src/jobs/billingAssistantJob');

async function test() {
  try {
    console.log("Running migrations...");
    await runMigrations({ backup: false });
    
    console.log("Running processReminders...");
    await processReminders();
    
    console.log("CRON test completed.");
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    process.exit(0);
  }
}

test();
