const db = require("../../db");
const { aggregateActivityLogs } = require("./aggregateActivityLogs");

async function run() {
  try {
    await aggregateActivityLogs();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}

run();
