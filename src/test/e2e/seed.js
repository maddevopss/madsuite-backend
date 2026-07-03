const bcrypt = require("bcrypt");
const setupInvoicesTestDB = require("../setupInvoicesTestDB");

function assertEnv() {
  if (!process.env.TEST_PASSWORD) {
    throw new Error("❌ Missing TEST_PASSWORD");
  }
}

async function seedE2EDatabase() {
  assertEnv();

  // Appeler le vrai seed qui crée les utilisateurs E2E
  await setupInvoicesTestDB();

  console.log("🌱 SEED OK");
}

// 💀 IMPORTANT
module.exports = { seedE2EDatabase };
